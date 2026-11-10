# HTTP API v1 contract

Base path: `/api/v1`. All JSON responses use `Content-Type: application/json`; errors use `{ "error": { "code": "...", "message": "..." } }`. API is unauthenticated only in the local testing deployment; never expose unrestricted paid model calls to the public Internet without authentication and rate limits.

## GET /api/v1/health

`200 {"status":"ok"}`. Must not depend on model provider connectivity.

## GET /api/v1/catalog

Returns normalized manifest, available variants and palette IDs. For each asset: `id`, `displayName`, `tags`, `variant`, `viewBox`, `assetUrl`. Background metadata: IDs, dimensions, associated palette. URLs are rooted at the same origin or fixed app asset host, not arbitrary external URLs.

Example (abbreviated):

```json
{
  "assets": [{
    "id":"book-main", "displayName":"Книга", "variant":"main",
    "tags":["education","reading"], "viewBox":[0,0,1446,977],
    "assetUrl":"/assets/catalog/book/main.svg"
  }],
  "palettes":["violet","teal","warm"],
  "canvasPresets":["square","landscape"]
}
```

## POST /api/v1/compositions

Request for a model-assisted or template-generated scene.

**Concept mode:**

```json
{
  "mode":"concept",
  "prompt":"Идеи складываются в единую картину",
  "palette":"violet",
  "canvasPreset":"square"
}
```

**Selected mode:**

```json
{
  "mode":"selection",
  "assetIds":["book-main","phone-main","puzzle-main"],
  "palette":"teal",
  "canvasPreset":"landscape",
  "prompt":"Связь знаний и технологий"
}
```

`prompt` is optional in selection mode; required and non-empty in concept mode. `assetIds` required in selection mode and must contain catalog IDs. Optional `seed` can be added if deterministic alternative generation is implemented. Preserve selected IDs unless user requests additional decoration.

Response:

```json
{
  "scene": {
    "version":1,
    "canvas":{"width":1000,"height":1000,"preset":"square"},
    "palette":"violet",
    "backgroundId":"background-square-violet",
    "layers":[{"id":"layer-001","assetId":"book-main","x":0.5,"y":0.5,"scale":0.7,"rotation":0,"opacity":1,"visible":true,"locked":false}]
  },
  "generation":{"mode":"concept","source":"llm","warnings":[]}
}
```

`source` is `llm` or `fallback`. Server returns scene only after validation; don't claim success if no layers are produced. `generation.warnings` is informational, not a substitute for failed validation.

Possible errors:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Bad JSON, palette, ID or prompt |
| 422 | `invalid_plan` | Model returned unusable plan with no safe fallback |
| 429 | `rate_limited` | API/service quota |
| 502 | `provider_error` | Upstream response failure |
| 504 | `provider_timeout` | Deadline exceeded |
| 500 | `internal_error` | Unexpected server error |

Set request limit, provider timeout and strict response schema. Avoid leaking raw model responses to clients by default.

## Static assets

GET `/assets/...` serves vetted immutable SVG from the catalog. In Docker, frontend reverse proxy may serve static assets directly; `GET /api/v1/catalog` URLs must still resolve from the browser.

## Explicit exclusions

- No `POST /upload`, server-side filesystem write, `POST /export`, account/session endpoints in initial scope.
- SVG export and scene JSON export happen client-side using one canonical renderer.
- If project persistence is introduced, add a new versioned API and specify an actual backing store rather than pretending files are durable shared cloud storage.

## Implementation validation

Go request and response structs must be covered by contract tests. Validate content type, JSON decode with unknown fields rejected for incoming requests, body limits, string limits, enum ranges, finite floats, and catalog membership.
