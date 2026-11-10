# Architecture

SyraVec uses a React/TypeScript editor, a Go HTTP API, and native SVG rendering. There is no server database, account system, or message queue.

## Scene model

Scene version 2 contains its illustration size, canvas format, palette, background, and ordered layers. Positions are normalized to the canvas. Every object uses its active original viewBox with a single fixed factor of 1; layers have no individual scale. Each layer keeps its own ID, asset ID, position, rotation, opacity, visibility, and lock state. Switching size replaces SVG source geometry and canvas dimensions while retaining layer data. Legacy projects discard individual scales on migration; exact old appearance cannot be preserved.

[`model.ts`](../web/src/model.ts) defines the model and transforms. [`Canvas.tsx`](../web/src/Canvas.tsx) handles pointer gestures, while [`svg.ts`](../web/src/svg.ts) renders the same geometry for preview and standalone export. Internal SVG IDs and references are namespaced per instance. Hidden layers are exported with `display="none"`; editor controls are excluded.

[`store.ts`](../web/src/store.ts) persists projects and uploaded SVGs in IndexedDB. Pointer gestures keep transient drafts and record one completed action in Undo. A scene revision prevents late model responses from replacing subsequent manual changes.

## Composition requests

`POST /api/v1/compositions` accepts:

- `auto`: exact catalog-name lists use the local layout; other text becomes a concept request.
- `concept`: the model chooses suitable catalog objects and their arrangement.
- `selection`: the model arranges exactly the supplied `assetIds`, including repeated instances.

Requests include the current palette, custom color roles, illustration size, canvas preset, and a variation seed. `planner: template` requests the local layout explicitly. Without a configured key, the default planner is the local template.

[`provider.go`](../api/provider.go) sends descriptions, native dimensions, aspect ratios, visual weights, and centers to the model. It accepts only a JSON plan with known IDs and valid scene parameters. Concept output is bounded to 1–12 items and 5000 tokens. Selection output covers the full current canvas (up to the editor’s existing 40-layer capacity); its output-token budget scales with the requested instance count. An invalid plan allows one repair attempt within the same 45-second generation deadline; provider failures are not retried automatically. There is no preliminary classifier or semantic input rejection.

[`layout.go`](../api/layout.go) estimates overlap using an 8×8 occupancy grid and balances visual weight by adjusting positions. It never shrinks objects to fit; cropping is allowed. Original SVG paths are never redrawn.

## Rearranging canvas objects

The Layers action accepts the current canvas without filtering out single objects, copies, uploaded SVGs, hidden layers, or locked layers. Explicit rearrangement may move locked layers but preserves their lock flags. Custom SVG descriptors (ID, name, viewBox) extend only that request’s catalog; raw SVG markup is never sent to the server or model. The request-local planner still charges the root server’s shared quotas.

The client and server validate the returned instance counts per asset ID. The client assigns each returned occurrence to a separate original layer in stable order, then applies positions, roles, and order to the existing layers. IDs, manually edited rotations, visibility, opacity, background, palette, and canvas format remain intact. One scene update records one Undo action. Errors, cancellation, and stale responses leave the scene unchanged.

The action identifies AI versus template output. Cancellation is available in both the inspector and Composer. Its footer stays outside the independently scrolling layer list.

## Asset preparation

The one-shot `assets` service reads both private source ZIPs from `originals/assets.zip` (large) and `originals/assets-small.zip` (small). [`prepare-assets.mjs`](../scripts/prepare-assets.mjs) normalizes the library, and [`asset-audit`](../api/cmd/asset-audit/main.go) measures bounds, occupancy, visual weight, and centroid with librsvg. Source geometry is preserved.

The prepared version-2 manifest contains 20 stable logical IDs, each with independent large/small source records, plus palette backgrounds from both sets. Source records include archive filenames, SHA-256 hashes, path counts, and measured geometry. An explicit 20-entry correspondence maps small source filenames to logical IDs, with a color-role check. It does not infer native sizes from the large set. The exact pairing is recorded in the manifest. Three source palette references provide six color roles; black and white remain unchanged. Custom SVG uploads are sanitized static vectors; selection supplies their names and geometry metadata for layout planning. Their native dimensions are unchanged. A composition containing custom SVGs keeps its current illustration size; the editor explains why switching is disabled. Backgrounds preserve their own viewBox and use proportional cover/cropping, never independent object transforms.

The two sets are staged and audited together, then the manifest is atomically replaced. Versioned source URLs keep the previous library usable until successful preparation. Docker publishes prepared assets only after successful preparation. API and web containers mount them read-only. Vite output lives under `/static/`, separate from the `/assets/` volume, so the library mount cannot hide application JS/CSS.

## Quotas and persistence

[`limits.go`](../api/limits.go) uses sliding timestamp windows: 5 main-model calls per IP per hour, 20 per IP per 24 hours, and 150 globally per 24 hours by default. All three checks and counter updates share one mutex. A model dispatch, including a repair, reserves quota immediately before the outbound POST; failed dispatched calls remain counted.

Counters use hashed normalized IPs and an atomic file replacement in the `api-data` Docker volume. Storage errors block model dispatch. HTTP 429 includes `Retry-After` and the wait until all exceeded windows permit another call. The implementation coordinates one API process; independent replicas would need shared coordination.

The container nginx resolves client addresses only through the configured trusted proxy network and overwrites `X-Real-IP`. The API uses that header only with `AI_TRUST_PROXY=true`; otherwise it uses `RemoteAddr`. The API port is not published by Compose.

## manual rotation only

Generation and template layouts always create layers with rotation 0. The model prompt forbids rotation and the structured schema restricts it to zero. The server discards any proposed angle before layout refinement; the client also discards angles in new generation responses. Recomposition retains each original instance’s manually edited rotation, including repeated asset IDs. Editor controls, undo/redo, saved projects and SVG export retain manual rotations.

## resumable composition requests

The browser persists the draft, request ID, payload and original scene with its project in IndexedDB before submitting. `POST /api/v1/compositions` with `X-Composition-Job` starts an idempotent background job; the unchanged synchronous endpoint remains available without this header. `GET /api/v1/compositions/{id}` returns 202 while running and the original response when complete. `DELETE` explicitly cancels a pending job or acknowledges a locally saved result. Switching projects or disconnecting a browser does not cancel it, and reconnecting with the same ID never issues a second provider request. Each result applies only to its originating project and only if that scene still matches the saved snapshot.

Jobs use the existing Go process, without a database or worker service. At most 1024 jobs are retained; unread results stay until the browser acknowledges durable local persistence, acknowledged/cancelled tombstones expire after 30 minutes; IDs are unguessable bearer capabilities and there is no listing endpoint. Process restarts discard them. An unavailable result reports an error while preserving the user's prompt. Provider timeout, concurrency limits, IP quotas and rotation restrictions still apply. An explicit stop cancels polling and the provider request; a page reload only stops polling and resumes the same job after hydration.

Artwork remains inside its SVG clip path; selection controls can render beyond the artboard, with overflow clipped by the outer editor viewport. Composer text and loading text share the same metrics and have no inner focus outline.
