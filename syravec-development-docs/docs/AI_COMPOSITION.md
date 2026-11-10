# AI composition planner and deterministic layout

## 1. Separation of concerns

The model **does** choose relevant catalog items (concept mode), visual hierarchy, rough location and emphasis. The model **does not** output SVG markup, create new assets, modify internal paths or dictate raw paint operations. Deterministic code builds the final valid scene.

## 2. Generation modes

### Concept mode

Input: text, palette, canvas preset, optional seed. Model receives compact catalog metadata: names, semantic tags, rough aspect ratios and allowed variants. It chooses a grounded subset (typical 2-5 main items), optional background variants and focal ordering.

### Selection mode

Input: explicit asset IDs, optional concept/hint, palette and format. Model may select emphasis and layout *only*; must include all required items. If LLM fails or is unconfigured, deterministic templates should still arrange the selected items (this is a particularly useful fallback and demo path).

## 3. Proposed model plan schema

```json
{
  "concept": "Образование и новые идеи",
  "items": [
    {"assetId": "book-main", "role": "focal", "preferredX": 0.53, "preferredY": 0.51, "relativeSize": 1.0, "rotation": -8},
    {"assetId": "lamp-main", "role": "support", "preferredX": 0.27, "preferredY": 0.32, "relativeSize": 0.7, "rotation": 14}
  ]
}
```

LLM plan is **not** canonical Scene JSON. `relativeSize`, semantic role and positions express intent; normalizer assigns precise scales and layer IDs, clamps values and runs layout checks.

## 4. Validation and normalization

- Reject unknown asset IDs and duplicate-required-item omissions.
- Reject `NaN`, infinity, missing required properties, out-of-range positions, huge rotations, negative or extreme scales.
- Limit items (e.g. max 12, normal default 2-5) and prompt length.
- For selection mode, reconcile exact selected IDs before accepting a plan; no new main items unless explicitly allowed.
- Score candidate positions. Keep main objects predominantly within frame; allow **intentional** overlapping for depth, rather than enforcing zero intersections.
- Prefer visible-art bounds or conservative bounding boxes; adjust for rotation. Do not confuse background decorative shapes with collision blockers.
- Deterministic tie-breakers and seeded sampling when generating alternatives.
- Return warnings if scoring cannot satisfy constraints; do not claim perfect layout by heuristic alone.

## 5. Layout templates to prototype

- Dominant center focal + 2 satellites.
- Balanced diagonal arrangement.
- Horizontal editorial grouping for landscape.
- Layered focal with secondary ghost/background variants.

For square and landscape output, adapt positions and scales rather than merely cropping an existing canvas.

## 6. Model provider

- Configurable API URL/model/key; key stays server-side.
- Prefer native JSON Schema-constrained response when selected provider supports it. If not, request JSON, strictly parse and validate; never assume cross-provider feature equivalence.
- Timeout and context cancellation; one bounded repair attempt only when valid JSON is returned but fails semantic checks, otherwise deterministic fallback.
- `temperature` and token budget configured conservatively; log provider status and latency, not raw keys.
- Do not disclose hidden prompt or raw provider credentials in the response.

## 7. Failure states

| Failure | Action |
| --- | --- |
| No AI key | Manual editor works; selection mode offers rule-based composition |
| Model timeout | Preserve current scene; surface retry with readable error |
| Invalid JSON | One bounded retry/repair or fallback; never render malformed layers |
| Unknown asset | Drop plan or request repair; never fabricate asset |
| Poor composition score | Try alternative deterministic placements |
| User edits while waiting | Reject stale response unless user explicitly applies it |

## 8. Evaluation dataset (to create)

At least 12 text prompts across education, creativity, finance, tech, productivity and metaphor. For each: record selected asset validity, no missing items, in-bounds rate, legibility, layout balance and subjective relevance. Run at both aspect ratios and all palettes. Save test outcomes as fixtures; manual visual QA remains necessary for aesthetic quality.

## 9. AI-native engineering evidence

Development may use a coding agent; project README should accurately distinguish AI-generated code assistance from implementation decisions, integration, testing and reviewed changes. Product model-planning calls are a separate feature from AI-assisted software development. Do not add fake usage claims or metrics.
