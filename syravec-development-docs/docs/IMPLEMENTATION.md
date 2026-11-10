# Implementation plan

Objective: deliver a complete, testable assignment rather than a broad design tool. All milestones end with observable evidence. Never mark a milestone done because code compiles alone.

## Milestone 0: SVG feasibility spike (blocking)

- [ ] Obtain canonical source ZIP (2) in local development environment.
- [ ] Extract 10 main and 10 background variants, 6 background presets; create manifest and stable IDs.
- [ ] Validate vector files, viewBoxes, safety constraints and name mapping.
- [ ] Render 3 very different objects (book, lamp, coin) in a native browser SVG using canonical transform.
- [ ] Render three copies of the same asset and check clip-path/defs ID scoping.
- [ ] Add move, rotate, scale using candidate React Moveable; compare against pointer-event fallback if needed.
- [ ] Export one standalone SVG and verify visual match and editability in another SVG-capable application.

**Gate:** No app-wide architecture hardening until rendering and export are demonstrated. Record whether Moveable is accepted or rejected in `DECISIONS.md`.

## Milestone 1: Asset pipeline and palette

- [ ] Normalize source names in build script; retain original geometry.
- [ ] Serve vetted static assets and manifest in web app.
- [ ] Implement explicit palette tokens and mappings for known fills.
- [ ] Render 20 asset variants in all 3 palettes and both formats.
- [ ] Test backgrounds and foreground contrast with visual reference review.

**Gate:** No missing or corrupted assets, no stray network refs, documented palette behavior and limitations.

## Milestone 2: Manual editor (core UI)

- [ ] Build layout: asset library, main canvas, properties/layers inspector, top controls.
- [ ] Add/duplicate/delete/select objects.
- [ ] Drag, uniformly scale, rotate, change z-order; handle locked/hidden layers if UI exposes them.
- [ ] Change canvas format, palette and background preset.
- [ ] Download self-contained SVG with consistent transforms.
- [ ] Support browser resizing and clear selected state.
- [ ] Optional project JSON import/export and Undo/Redo after core DoD.

**Gate:** Manual composition works without backend AI key.

## Milestone 3: Go backend and AI generation

- [ ] Go server health and catalog endpoints with JSON validation.
- [ ] Provider client with model config, timeout, cancellation and structured output strategy.
- [ ] Concept planner (fixed library) and selection planner (fixed IDs).
- [ ] Normalize AI plan to canonical Scene; validate IDs, size/number/geometry ranges.
- [ ] Implement layout templates, in-bounds/overlap scoring and fallback.
- [ ] Connect generation UI, loading states, cancellation and error handling.
- [ ] Cover invalid responses and stale generation behavior.

**Gate:** Both generation modes produce editable compositions and handle provider failures without losing state.

## Milestone 4: Packaging, quality and handoff

- [ ] Dockerfiles for web and api, `compose.yaml`, health checks and `.env.example`.
- [ ] Same-origin `/api` proxy; no AI key in client bundle.
- [ ] Go tests, frontend unit tests, E2E smoke suite.
- [ ] Validate SVG with XML parser; compare selected exports visually.
- [ ] Document deployment, limitations and model configuration.
- [ ] Record 2-3 representative outputs, short demonstration and architecture summary.
- [ ] Confirm licenses for publishing source illustrations in a public repository.

**Gate:** Fresh clone -> config -> `docker compose up --build` -> create, edit, export without undocumented steps.

## Time priority for two-working-day submission

1. First ensure **asset correctness, editable canvas, standalone SVG export**.
2. Then both AI workflows, including fallback for selected assets.
3. Then design polish, error handling, container setup and README.
4. Only if time remains: persistent projects, animation, multi-selection, sophisticated physical layout optimization.

Avoid overengineering: no Postgres, Redis, background workers, microservices or general-purpose SVG upload pipeline without demonstrated necessity.

## Working conventions

- Small commits by vertical slice; each contains tests and an explicit manual check.
- Run lint/typecheck/test after relevant changes, not only at end.
- Document notable deviations from this plan in `DECISIONS.md`.
- Keep any secret and personally identifiable test input out of git.
