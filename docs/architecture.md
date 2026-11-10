# Architecture

SyraVec uses a React/TypeScript editor, a Go HTTP API, and native SVG rendering. There is no server database, account system, or message queue.

## Scene model

A scene contains its canvas format, palette, background, and ordered layers. Layer positions are normalized to the canvas; scale is uniform relative to the original SVG viewBox. Each layer keeps its own ID, asset ID, transform, opacity, visibility, and lock state.

[`model.ts`](../web/src/model.ts) defines the model and transforms. [`Canvas.tsx`](../web/src/Canvas.tsx) handles pointer gestures, while [`svg.ts`](../web/src/svg.ts) renders the same geometry for preview and standalone export. Internal SVG IDs and references are namespaced per instance. Hidden layers are exported with `display="none"`; editor controls are excluded.

[`store.ts`](../web/src/store.ts) persists projects and uploaded SVGs in IndexedDB. Pointer gestures keep transient drafts and record one completed action in Undo. A scene revision prevents late model responses from replacing subsequent manual changes.

## Composition requests

`POST /api/v1/compositions` accepts:

- `auto`: exact catalog-name lists use the local layout; other text becomes a concept request.
- `concept`: the model chooses suitable catalog objects and their arrangement.
- `selection`: the model arranges exactly the supplied `assetIds`, including repeated instances.

Requests include the current palette, custom color roles, canvas preset, and a variation seed. `planner: template` requests the local layout explicitly. Without a configured key, the default planner is the local template.

[`provider.go`](../api/provider.go) sends descriptions, aspect ratios, visual weights, and centers to the model. It accepts only a JSON plan with known IDs and valid scene parameters. Concept output is bounded to 1–12 items and 5000 tokens. Selection output covers the full current canvas (up to the editor’s existing 40-layer capacity); its output-token budget scales with the requested instance count. An invalid plan allows one repair attempt within the same 45-second generation deadline; provider failures are not retried automatically. There is no preliminary classifier or semantic input rejection.

[`layout.go`](../api/layout.go) constrains rotated objects to the canvas, estimates overlap using an 8×8 occupancy grid, and balances visual weight. Original SVG paths are never redrawn.

## Rearranging canvas objects

The Layers action accepts the current canvas without filtering out single objects, copies, uploaded SVGs, hidden layers, or locked layers. Explicit rearrangement may move locked layers but preserves their lock flags. Custom SVG descriptors (ID, name, viewBox) extend only that request’s catalog; raw SVG markup is never sent to the server or model. The request-local planner still charges the root server’s shared quotas.

The client and server validate the returned instance counts per asset ID. The client assigns each returned occurrence to a separate original layer in stable order, then applies positions, scales, rotations, roles, and order to the existing layers. IDs, visibility, opacity, background, palette, and canvas format remain intact. One scene update records one Undo action. Errors, cancellation, and stale responses leave the scene unchanged.

The action identifies AI versus template output. Cancellation is available in both the inspector and Composer. Its footer stays outside the independently scrolling layer list.

## Asset preparation

The one-shot `assets` service reads the private source ZIP from `originals/assets.zip`. [`prepare-assets.mjs`](../scripts/prepare-assets.mjs) normalizes the library, and [`asset-audit`](../api/cmd/asset-audit/main.go) measures bounds, occupancy, visual weight, and centroid with librsvg. Source geometry is preserved.

The prepared library contains 20 objects, including main/background pairs, plus format-specific backgrounds. Three source palette references provide six color roles; black and white remain unchanged. Custom SVG uploads are sanitized static vectors; selection supplies their names and geometry metadata for layout planning.

Docker publishes prepared assets only after successful preparation. API and web containers mount them read-only. Vite output lives under `/static/`, separate from the `/assets/` volume, so the library mount cannot hide application JS/CSS.

## Quotas and persistence

[`limits.go`](../api/limits.go) uses sliding timestamp windows: 5 main-model calls per IP per hour, 20 per IP per 24 hours, and 150 globally per 24 hours by default. All three checks and counter updates share one mutex. A model dispatch, including a repair, reserves quota immediately before the outbound POST; failed dispatched calls remain counted.

Counters use hashed normalized IPs and an atomic file replacement in the `api-data` Docker volume. Storage errors block model dispatch. HTTP 429 includes `Retry-After` and the wait until all exceeded windows permit another call. The implementation coordinates one API process; independent replicas would need shared coordination.

The container nginx resolves client addresses only through the configured trusted proxy network and overwrites `X-Real-IP`. The API uses that header only with `AI_TRUST_PROXY=true`; otherwise it uses `RemoteAddr`. The API port is not published by Compose.
