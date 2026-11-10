# Architecture and scene model

## 1. Components

```text
Browser (React/TS)
  Asset library + canvas + layer inspector
  Zustand: canonical Scene state
  SVG renderer (native <svg> + <g> + embedded asset markup)
  Editor interactions (pointer events / Moveable adapter)
  SVG exporter (same rendering tree -> serialized, self-contained SVG)
           | JSON REST
Go API (net/http)
  catalog endpoint
  request validation
  LLM planner client
  composition normalizer / layout scorer
  scene response
           | HTTPS
      Model provider
```

The backend does not need to rasterize, render previews or rebuild the entire SVG. It never controls fine-grained SVG path geometry. The browser owns the canonical rendered scene and export. The server returns *scene data* and may normalize layout coordinates.

## 2. Scene schema v1 (canonical)

```json
{
  "version": 1,
  "canvas": {"width": 1000, "height": 1000, "preset": "square"},
  "palette": "violet",
  "backgroundId": "background-square-violet",
  "layers": [
    {
      "id": "layer-001",
      "assetId": "book-main",
      "x": 0.53,
      "y": 0.48,
      "scale": 0.58,
      "rotation": -12,
      "opacity": 1,
      "visible": true,
      "locked": false
    }
  ]
}
```

Definitions:
- Coordinates `x,y` are **normalized canvas center coordinates** (0 to 1). They refer to the center of the asset's intrinsic `viewBox`, not top-left.
- `scale` is a dimensionless factor applied to the asset's source size after **base normalization**. `scale=1` means the asset's longest side occupies 40% of the shorter canvas side (initial design constant; make it configurable). This avoids a `book` 1446-units-wide and `coin` 287-units-wide mismatch.
- `rotation` degrees clockwise in screen coordinates; `scale > 0`; `opacity` in [0,1].
- `layers` array order is painter order: earlier behind later.
- Unique `layer.id` is separate from stable `assetId`, allowing repeated assets.
- `backgroundId` selects a preset background. It is not a transformable layer in MVP.
- `palette` identifies semantic recolor mapping. Palette values defined in `ASSETS.md`.
- Scene version enables forward compatibility; reject unknown versions with actionable error.

**Important:** The JSON above is a proposed contract. It is not an example copied from the assignment.

## 3. Transform contract

For asset `A` with intrinsic `viewBox (vx,vy,vw,vh)`, canvas `(W,H)` and normalized center `(x,y)`:

```text
base = 0.40 * min(W,H) / max(vw,vh)
actualScale = base * layer.scale
cx = W * layer.x
cy = H * layer.y

transform = translate(cx cy)
            rotate(layer.rotation)
            scale(actualScale)
            translate(-(vx + vw/2) -(vy + vh/2))
```

Order matters. The renderer and serializer must use **one shared transform utility**; do not independently recompute numbers in UI and exporter. For a background asset, use the SVG's intrinsic bounds exactly and allow transparent padding; pixel-accurate visible-content bounds may be derived during preprocessing if needed.

## 4. SVG component strategy

Candidate A (preferred for fixed, trusted catalog): inline each source asset inside a scoped `<g>`, carrying SVG graphics nodes and required `<defs>`. Prefix every internal ID/reference (`id`, `url(#id)`, `href="#id"`, style references) by the unique scene layer ID. Treat source SVG as vetted static data, not untrusted HTML. Sanitization occurs in asset preparation, and tests verify scope rewriting.

Candidate B: embed a `symbol` for each distinct asset and use `<use>` for instances, with all local definitions embedded in the exported root document. Compare rendering and export interoperability before adopting this optimization. Avoid external `href` references in the final file.

**Never** rely on `<image href="asset.svg">` if a downstream editor must preserve the object's path geometry as editable vector content. Nor on CSS fetching external files. All geometry/definitions must be self-contained in exported SVG.

## 5. Export

1. Take a *snapshot* of canonical Scene state.
2. Build the same SVG document tree used by preview, without selection outlines, handles, grid or app chrome.
3. Inline source geometry and definitions, scope IDs, apply palette map and per-layer transforms.
4. Serialize to UTF-8 XML/SVG (`XMLSerializer` or a tested DOM-based exporter).
5. Include width, height, viewBox and namespace; download with image/svg+xml MIME.
6. Parse exported file independently and compare visual preview with browser screenshot and a second SVG renderer.

Avoid duplicating asset geometry in two implementations. If exporting from a hidden export-only SVG, its scene renderer must be the same component and transform helper.

## 6. State responsibilities

- `Scene` includes all persistent visual choices.
- Local ephemeral UI includes current selection, pointer drag state, zoom, viewport pan, open tabs and toast notifications.
- User edits should update canonical Scene only after a transaction or through a single reducer-like action. Drag previews can be transient but must commit exact values.
- Undo/redo, if added, stores semantic transactions and does not snapshot every pointer move.
- Generation uses request ID and abort controller; stale network responses may not replace newer user edits.

## 7. API/backend modules

Suggested boundaries (not mandatory boilerplate):

```text
api/cmd/server/main.go
api/internal/httpapi/{catalog,compose,health}.go
api/internal/catalog/{manifest,validation}.go
api/internal/composition/{scene,normalize,layout,score}.go
api/internal/ai/{client,prompt,parse}.go
web/src/{app,components,features,lib,store,types}/
assets/{originals,normalized,manifest.json}/
```

Do not introduce interfaces purely for dependency injection. Use small concrete types except at external seams (model provider, catalog reader), where test stubs are useful.

## 8. Data security

- Source files trusted at build-time only after safety lint (no scripts, event handlers, foreignObject, network URLs, external stylesheets or unsafe references).
- Validate every `assetId` server-side against manifest; validate finite numbers, lengths, layer limits and total response size.
- Keep provider secret only in API environment, never in JS bundle or returned error.
- Restrict cross-origin requests to configured frontend origin in development. In Docker production-style setup, route `/api` through the same-origin frontend proxy.
- No arbitrary user SVG upload in v1, so avoid building an unsafe SVG ingestion endpoint.

## 9. Quality risks

- ID collisions between multiple copies of same SVG.
- Wrong transform order or visible bounds causing off-center placement.
- Palettes producing low contrast.
- Export importing differently into third-party tools than browser preview.
- Object overlap checking based on axis-aligned source dimensions over-penalizing illustrations with transparent whitespace.

These risks must be resolved in Milestone 0-1, not postponed until polish.
