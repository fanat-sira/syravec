# Quality assurance and submission

## 1. Required test layers

### Static/contract
- Go `go test ./...`, `go vet ./...`.
- TypeScript `tsc --noEmit`; Vitest for transform math, scene reducers, palette mapping and serializer.
- Validate manifest references and source SVG XML; fail build when required assets absent.

### SVG export invariants
- Exported SVG root has `xmlns`, `viewBox`, positive dimensions.
- No `<image>` with external `href`, no remote imports, no script/event handlers.
- Every layer appears as vector geometry or local symbol instance, never raster preview.
- Duplicating an asset must not create colliding IDs (`clipPath`, gradients, masks).
- Transform after save/reopen preserves logical position, scale and rotation.
- A palette change leaves geometry and element counts unchanged.
- Export independently opens in at least one other SVG application/viewer.

### UI smoke
- Manual editor with no API key remains usable.
- Add item, drag, rotate, scale, duplicate, change stacking, export.
- Select 3 assets and auto-arrange them.
- Enter concept and generate via configured provider.
- Simulate provider error and delayed response after edit; protect existing scene.
- Palette and format changes remain valid and visible.

### Visual test matrix

| Scenario | Square | Landscape | Each palette |
| --- | --- | --- | --- |
| book + phone + puzzle | Yes | Yes | Yes |
| lamp + flowers | Yes | Yes | Yes |
| coin + wallet + folder | Yes | Yes | Yes |
| same asset repeated | Yes | Yes | Violet minimum |
| all available assets in preview grid | Yes | N/A | Yes |

A reviewer must inspect at 100% and after exporting, including edge clipping and low-contrast issues.

## 2. AI evaluation

- Every requested selected asset remains in returned Scene.
- Zero fabricated asset IDs.
- Object bounds are mostly within frame by documented policy.
- Intentional overlaps permitted; unreadable stacks are flagged.
- Model error, malformed JSON and missing credentials do not crash editor.
- At least a dozen diversified concept prompts reviewed manually.

## 3. Security check

- No tokens, `.env`, credentials, copied conversation contents or other secrets committed.
- Provider client runs on API only; no secrets in response.
- No arbitrary raw SVG input from visitors.
- Source asset sanitation and self-contained export enforced.
- Published repo artwork permission reviewed separately.
- If hosted publicly, protect paid AI endpoint against unrestricted use.

## 4. Reviewer first-run experience

- [ ] Repository README accurately describes finished features (not just planned ones).
- [ ] `docker compose up --build` works on a fresh environment after `.env` setup.
- [ ] Browser URL and configuration examples match actual ports.
- [ ] Clear empty state, example prompt, visible generate action.
- [ ] Error message for missing API key and mode for trying manual editor.
- [ ] Screenshot or short video of generation -> edit -> export.
- [ ] At least 2-3 exported standalone SVG results.
- [ ] No dead buttons, broken links or fake capabilities.
- [ ] `LICENSE` and asset usage attribution are correct.

## 5. Definition of done

**Done** means: someone unfamiliar with the project can launch it, use both AI workflows (with configured provider), manually edit output, switch three palettes and formats, export editable standalone SVG, and understand the limits without assistance.

If any item is unimplemented, label it honestly in README and delivery notes rather than hiding it.
