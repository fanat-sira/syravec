# Asset library, palette model and preprocessing

## 1. Audited source ZIPs

Two exported Figma ZIP archives were inspected:

- `Тестовое _ иллюстрации(2).zip`: 26 SVG files, 10 main illustrations + 10 monochrome/background variants + 3 square and 3 landscape background/palette samples. Use as **authoritative asset set for v1**, because main/background pairs share viewBox dimensions.
- `Тестовое _ иллюстрации(3).zip`: similar content at roughly half the intrinsic viewBox size in most cases, with different naming/organization. Keep for comparison, not mixed into the canonical catalog.

Asset kinds and names below are mapped from filenames and preview inspection, not guessed by machine learning.

### Catalog mapping for ZIP (2)

| ID | Main source | Background variant source | Intrinsic viewBox |
| --- | --- | --- | --- |
| `puzzle` | `Пазлы.svg` | `Пазлы-1.svg` | 545 × 314 |
| `book` | `Книга.svg` | `Книга-1.svg` | 1446 × 977 |
| `phone` | `Телефон.svg` | `Телефон-1.svg` | 797 × 462 |
| `headphones` | `Наушники.svg` | `Наушники-1.svg` | 889 × 692 |
| `lamp` | `Лампа.svg` | `Лампа-1.svg` | 946 × 1129 |
| `wallet` | `Кошелек.svg` | `Кошелек-1.svg` | 631 × 397 |
| `pen` | `Ручка.svg` | `Ручка-1.svg` | 509 × 286 |
| `folder` | `Папка.svg` | `Папка-1.svg` | 1241 × 659 |
| `coin` | `Монета.svg` | `Монета-1.svg` | 287 × 189 |
| `flowers` | `Group 2136136344.svg` | `Group 2136136347.svg` | 591 × 748 |

`-1` denotes supplied monochrome/back-layer version, **not** palette index. Preserve that distinction.

### Background samples

- Square (1000 × 1000): `Фон.svg` (violet), `Фон-1.svg` (teal), `Фон-2.svg` (warm).
- Landscape (1000 × 633): `Group 2136136332.svg` (violet), `Group 2136136333.svg` (warm), `Group 2136136334.svg` (teal).
- These are **background design elements**, not a guarantee that every shape in main objects has an equivalent pre-authored color for every palette.

## 2. Intended normalized package

```text
assets/
  source/                    # original ZIP source archived locally, not necessarily committed
  catalog/
    book/main.svg
    book/background.svg
    phone/main.svg
    phone/background.svg
    ...
  backgrounds/
    square/{violet,teal,warm}.svg
    landscape/{violet,teal,warm}.svg
  manifest.json
```

Example manifest entry:

```json
{
  "id": "book",
  "displayName": "Книга",
  "tags": ["learning", "reading", "knowledge", "education"],
  "variants": {
    "main": "/assets/catalog/book/main.svg",
    "background": "/assets/catalog/book/background.svg"
  },
  "viewBox": [0, 0, 1446, 977]
}
```

Catalog choices should use stable IDs (`book`, not localized file labels). For Scene layers use `assetId: "book-main"` or `"book-background"`; the manifest loader should expose these as unique variant keys.

## 3. SVG ingestion rules (build-time)

- Keep source paths/curves exactly, preserve `viewBox` and intrinsic aspect ratio.
- Strip metadata/editor-specific nodes and dangerous content, but keep graphical semantics (`path`, `rect`, `line`, groups, `defs`, clip paths, fills, stroke, opacity, transforms).
- Do not blindly remove `id`s needed by `clip-path`, fills, gradients, patterns or masks.
- Detect any external URL/reference, embedded raster or script and fail preprocessing until reviewed.
- Minification is optional; visual correctness is more important than marginal size reduction.
- Catalog and background paths are local and immutable at runtime.

## 4. Palette reality and design

Observed violet background colors include `#7864D7`, `#AA9BF0`, `#D7CDF5`. Teal backgrounds include `#5ABEBE`, `#80DADA`, `#BEEBEB`. Warm backgrounds include `#D27532`, `#FAC896`, `#FDD7B9`.

Some main illustrations use violet, pale yellow, pink, near-black and white simultaneously. A naive global string replacement will destroy deliberate shading and subject color. We must not assume all fills have direct palette equivalents.

**Proposed mapping strategy:**
1. Audit the unique fills in every illustration and background.
2. Define a small semantic role map for `accent-strong`, `accent-medium`, `accent-light`, `highlight`, `shadow`, `ink`, `white`, and any genuinely object-specific colors. Assign observed hex values after reviewing source combinations.
3. For each palette, map only known design tokens, preserving ink and neutral whites unless explicit design references say otherwise.
4. Prefer injecting CSS variables into vetted SVG nodes at preparation time or generating explicit fill replacements from a measured mapping table. The export must resolve variables to explicit styles or embed all required CSS.
5. Visual-compare each of the 10 main and 10 background assets in all 3 palettes. Any undefined source color must stay unchanged and be recorded, not silently guessed.

**Stop/go:** This mapping cannot be considered complete until a visual test shows correct object rendering in all three palettes. If the test allows only background theme changes, the original main illustration colors can be left stable, but that is a deliberate product decision requiring confirmation.

## 5. Visual bounds

`viewBox` bounds represent canvas size, not necessarily visible art bounds. Some objects have large transparent padding or shape clusters. For collision-aware layout, optionally generate visible-content bounding boxes using a trusted renderer or manual inspection and store the bounds in the manifest. Do not alter source paths to force a tight bounding box without evidence.

## 6. Asset tests

- Every normalized SVG parses as XML and has a positive finite viewBox.
- Main/background pair viewBoxes match, or documented normalization accounts for difference.
- No external references or embedded raster data in exported illustration.
- Same asset instantiated three times has no definition/clip-path ID collisions.
- Export remains visually consistent after opening as standalone file.
- Palette transformations preserve number and shape of paths and all geometry attributes.

## 7. Publication and ownership

Source illustrations are provided for a hiring test. **Do not publish them in the public GitHub repository without checking redistribution permissions.** Docs and application code can be public while assets are supplied separately, or demo assets can be used with explicit permission.
