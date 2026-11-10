# Instructions for coding agents

You are implementing **SyraVec**, an AI-assisted SVG composition editor for a fixed supplied asset library. Read `README.md`, `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/ASSETS.md` and `docs/IMPLEMENTATION.md` before making architectural changes.

## Non-negotiable behavior

1. **Do not generate or redraw source illustrations.** Compose exactly the provided vectors via transformations and overlays.
2. **Scene JSON is canonical.** Rendering and export must derive from the same model and geometry utilities; never build divergent SVG transformation logic for preview vs output.
3. **Standalone SVG.** No rasterization of illustration objects and no references to local or remote files in the exported SVG.
4. **Fixed catalog only for v1.** Do not implement arbitrary SVG upload or inject untrusted SVG strings into the DOM.
5. **Backend secret isolation.** Provider key stays in Go server environment. Don't put credentials into the frontend.
6. **Go in preference to Python** unless a concrete test proves a necessary feature impossible or impractical. Do not add Python runtime or microservices as a convenience.
7. **Do not overengineer.** No database, queue, message broker, Kubernetes, accounts or unnecessary abstractions.
8. **No speculative UI.** Make visible controls work and reflect current Scene state. Correct export is more important than polish.
9. **No fictional QA.** Do not say something passed until commands/tests actually ran. Record failures and missing dependencies.
10. **Source asset rights.** Do not commit supplied illustrations to public GitHub until permissions are verified.

## Work order

Start with the feasibility spike in `docs/IMPLEMENTATION.md`. Make a 3-asset editable SVG scene and standalone export before developing the AI feature. Document the outcome of Moveable vs pointer events in `docs/DECISIONS.md`.

## Scene and API rules

- Use `docs/ARCHITECTURE.md` Scene v1 schema, asset naming from `docs/ASSETS.md` and contract from `docs/API.md`.
- Typed errors and structured responses; no silent model JSON failures.
- Ensure selected-object mode includes exactly the explicitly selected main assets by default, while decorative background variants can be enabled separately.
- Layout generation should return validated scene data; never accept raw model SVG or CSS.
- Preserve scene after failed generation and ignore stale requests.

## Before each meaningful commit

- Run relevant test, lint, and typecheck commands.
- Exercise the modified feature in a browser when UI/SVG rendering changed.
- Inspect exported SVG outside preview when export code changed.
- Update docs if contract or architecture changes; record why, not just what.
- Avoid giant one-shot implementations. Finish vertical slices and commit once they work.

## Delivery standard

Project must run from a fresh clone with documented Docker Compose instructions, show all supported library assets, both AI workflows, manual transforms, palettes/formats and vector export. Disclose any unimplemented functionality candidly.
