# SyraVec

AI-assisted SVG composition editor. **Project status: specification, not an implemented product.**

SyraVec composes existing illustrated objects into editable vector scenes. It does not generate new SVG shapes from scratch. A language model can select assets and plan an arrangement; a deterministic scene engine validates, normalizes, displays and exports the result.

## Documentation

| Document | Purpose |
| --- | --- |
| [Product specification](docs/PRODUCT_SPEC.md) | Features, constraints and acceptance criteria |
| [Architecture](docs/ARCHITECTURE.md) | Components, scene model, editing and rendering |
| [Assets and palettes](docs/ASSETS.md) | Normalization, geometry, recoloring, source asset audit |
| [AI composition](docs/AI_COMPOSITION.md) | Planning, layouts, failure handling and evaluation |
| [API contract](docs/API.md) | Endpoints, types and responses |
| [Implementation plan](docs/IMPLEMENTATION.md) | Vertical slices, priorities, checkpoints |
| [Quality](docs/QUALITY.md) | Testing matrix and final submission definition of done |
| [Decisions](docs/DECISIONS.md) | Locked decisions, hypotheses and unresolved issues |
| [Agent instructions](AGENTS.md) | Constraints for AI-assisted implementation |

## Planned stack

- Backend: Go, standard `net/http`, built-in JSON handling and explicit validation.
- Frontend: React, TypeScript, Vite, Zustand, native browser SVG.
- Drag/resize/rotate: React Moveable **candidate pending spike**, with a custom pointer-events implementation as fallback.
- AI: configurable OpenAI-compatible text model with structured JSON output (provider support must be verified and non-structured fallback validated).
- Containerization: Docker Compose, two services (`web` and `api`).
- Persistence: no server DB required. Project JSON import/export; browser local storage may be added after core functionality.

## Key principle

**The scene JSON is the source of truth.** AI produces a scene proposal, users edit the same scene, and standalone SVG export is derived from the same scene. SVG assets remain opaque vector artwork: no redrawing their internal paths.

## Starting the implementation

Read [AGENTS.md](AGENTS.md), [Product specification](docs/PRODUCT_SPEC.md), and [Architecture](docs/ARCHITECTURE.md). Begin with Milestone 0 in [Implementation plan](docs/IMPLEMENTATION.md) to prove that a scene with several SVG objects renders and exports without losing definitions, geometry or fill rules.

The supplied SVG ZIP files are input materials; the normalized asset library is **not bundled in this documentation package**.

## Attribution

Independent take-home project. Design assets provided for the assignment. Do not claim affiliation with the hiring company's product, and verify rights before publishing the supplied artwork in a public repository.
