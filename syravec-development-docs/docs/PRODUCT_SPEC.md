# Product specification

## 1. Product goal

Build a browser application that produces coherent vector illustrations by composing *pre-existing* SVG objects. The output must remain a standalone SVG and be manually adjustable.

The source assignment provided vector assets, examples and three visual palette directions. This document formalizes the requirements discussed for the test. It is **not** a verbatim transcription of the original Figma page; any ambiguous items are marked as assumptions or design decisions.

## 2. Primary user journeys

### A. Concept-driven generation (required)
1. User enters a headline, topic or metaphor in Russian or English.
2. User selects output aspect ratio and palette (or accepts defaults).
3. AI selects suitable items **only** from the fixed catalog and proposes a layout.
4. Application checks IDs, bounds, constraints, and collisions before rendering.
5. User can edit the result and export SVG.

### B. Selected-object generation (required)
1. User selects two or more items from the catalog (allow a single item if asked).
2. User requests automatic composition. No model is required to decide the selected IDs.
3. AI or rule-based planner assigns emphasis and rough arrangement; solver refines geometry.
4. User may regenerate an alternative, then edit/export it.

### C. Manual composition and editing (required)
1. User adds or removes a catalog item on canvas.
2. Click to select; drag; rotate; uniformly scale; duplicate; change z-order.
3. Change canvas format and palette. Changes are deterministic and keep source artwork intact.
4. Export a standalone SVG; reopen it in a standard SVG viewer.

## 3. Functional requirements

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| F-01 | Asset library | Every approved main and background asset is listed, previewed and selectable. |
| F-02 | Concept AI mode | Generates a valid nonempty scene for representative concept prompts without inventing assets. |
| F-03 | Selected-assets mode | Every selected asset appears at least once unless user explicitly removes it. No unselected main asset is inserted by default. |
| F-04 | Manual editor | Selection, drag, rotate, scale, duplicate, delete, and raise/lower work. |
| F-05 | Aspect ratios | Square and landscape preset, with logical canvas dimensions and re-layout (not cropping) on AI regeneration. |
| F-06 | Three palettes | Background preset and correctly mapped main/background object fills. Palette change never modifies geometry. |
| F-07 | Vector export | Downloaded file is valid, standalone SVG; no rasterized illustration layers or network references. |
| F-08 | Retry/errors | Provider failure and invalid generation show a useful error; prior scene is preserved. |
| F-09 | Reproducibility | Scene JSON serialization and SVG generation produce repeatable results for the same scene. |
| F-10 | First-run experience | A user can generate, edit, and export without reading source code. |

## 4. Important scope decisions

### MVP commitments
- Use **only provided catalog assets**. No arbitrary user SVG upload in v1.
- No image generation endpoint; LLM plans arrangements of fixed components.
- No internal path/node editing or freeform vector drawing.
- Background variants of objects are catalog assets, not automatically generated recolors.
- Do not assume that a background preset equals the complete object palette: palette mapping must be demonstrated separately.
- No login, user management, collaborative editing, cloud storage, job queue or payment handling.

### Optional polish after acceptance
- Undo/redo, keyboard shortcuts, multi-selection, project JSON import/export, AI generation details, several candidate layouts.
- Any optional feature must not delay F-01 through F-10.

## 5. Interaction and UX constraints

- Desktop-first editor; minimum viable small-screen view must not break or lose controls.
- Left panel: asset library and mode selection. Center: canvas, zoom and selection. Right: selected-layer properties and layers. Top: palette, format and export.
- The AI text field must not obstruct manual edits.
- Clearly show generating and failed states. Never replace a good scene with an invalid partial response.
- No advertising-like template chrome or faux dashboard metrics. Visual language should foreground the artwork.

## 6. Non-functional requirements

- `docker compose up --build` starts both services using documented configuration.
- The frontend remains usable for manual editing without configured AI credentials; AI action is disabled with explanation.
- API credentials never ship to the browser.
- Strict model JSON parsing with size/time limits and context cancellation.
- SVG export must work with the network disconnected after the editor and catalog assets have loaded.
- Maintain license provenance for supplied artwork; do not include artwork in a public repo until publication is permitted.

## 7. Representative acceptance scenarios

- Concept: `Идеи складываются в единую картину` -> choose plausible catalog assets, coherent arrangement, visible composition, valid export.
- Concept: `Финансовая грамотность` -> select from available vocabulary, no invented icons.
- Selected: book + phone + puzzle -> all three present and editable.
- Manual: add headphones, duplicate, move to front, rotate, then change format and export.
- Palette: switch all 3 presets and confirm foreground, secondary, background layers remain visually legible.
- Negative: fake `asset_id` returned from mock LLM must be rejected, prior scene preserved.

## 8. Unknowns requiring evidence

- Exact target dimensions, if any, mandated beyond example square and landscape assets.
- Whether the employer expects exact palette swaps for foreground object fills, or allows coordinated approximations. Our implementation aims at explicit palette mapping with visual QA.
- Whether arbitrary user-uploaded SVG is truly required by the original test statement. Prior interpretation considers fixed library sufficient; confirm original text before extending scope.
