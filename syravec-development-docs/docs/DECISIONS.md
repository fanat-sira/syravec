# Architecture decisions and open risks

Decision status: **accepted** = agreed for current MVP; **candidate** = prototype needed; **open** = must be resolved by evidence.

| ID | Status | Decision | Rationale / verification |
| --- | --- | --- | --- |
| ADR-001 | Accepted | Fixed catalog, not arbitrary SVG editor | Task can be fulfilled with supplied vector objects; makes safe SVG handling tractable |
| ADR-002 | Accepted | Go API using standard `net/http` | JSON validation, LLM API I/O, deterministic layout; no Python-only capability needed |
| ADR-003 | Accepted | React + TS + Vite | Rich interactive browser editor and typed state |
| ADR-004 | Accepted | Native SVG preview/export | Source geometry remains vector; no raster canvas round-trip |
| ADR-005 | Accepted | Canonical Scene JSON | One source for AI proposals, edits, export and tests |
| ADR-006 | Candidate | React Moveable | Validate SVG behavior, center-based scaling, zoom interactions and export in spike |
| ADR-007 | Accepted | Client SVG serialization | Same renderer used for canvas and standalone file; validate with integration test |
| ADR-008 | Accepted | No DB/queue for initial delivery | No multiuser persistence or background workload in acceptance scope |
| ADR-009 | Open | Full recoloring semantics | Three design schemes exist but mapping of every foreground shade is not fully specified |
| ADR-010 | Accepted | Provider-agnostic server boundary | LLM calls are JSON planning; actual structured schema support varies by provider |
| ADR-011 | Open | Asset redistribution on public GitHub | Assignment source images may be restricted; get permission before commit |
| ADR-012 | Candidate | Background SVG as a separate immutable canvas root | Must verify no zoom, viewBox or export inconsistencies |
| ADR-013 | Open | Original assignment precise sizing/upload language | Need verify from readable original specification or employer; fixed catalog assumed in v1 |

## Known technical risks

**R1: Source SVG definition collisions.** Inline repeated SVGs can reuse local IDs. Namespace them by layer ID, test duplicate use.

**R2: Geometry normalization.** Large variation in intrinsic viewBox dimensions and possible transparent padding. Implement one transform formula and optionally visible-art bounding boxes.

**R3: Palette correspondence.** Violet monochrome secondary variants exist, but parallel monochrome variants for other colors are not included. Recolor mappings need visual verification.

**R4: Export mismatch.** DOM SVG syntax, CSS variables, `<use>` and `<defs>` may render differently between browsers and vector editors. Validate with independent renderer.

**R5: Model reliability.** Strict JSON output availability depends on provider. Keep hard validation, bounded retries and deterministic fallback.

**R6: Frontend interaction abstraction.** Third-party move handles may not honor viewport pan/zoom or rotation snapping. Spike before committing to UI architecture.

## Explicit future possibilities, not MVP promises

- User-uploaded SVG with strict sanitization pipeline and resource limits.
- Server-side rendering and thumbnail jobs.
- Cloud workspaces and collaboration.
- Hierarchical/constraint-based layout solver with real geometry intersections.
- PNG/PDF export. Current requirement is SVG.
