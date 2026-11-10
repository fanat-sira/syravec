# OpenRouter request and response

The Go API sends `POST {AI_BASE_URL}/chat/completions`. The default base URL is `https://openrouter.ai/api/v1`; `AI_MODEL` selects the model. No preliminary classifier is called.

## Headers

```text
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
X-Title: SyraVec
```

The provider key is added by the backend, never by the browser.

## Request body

The body contains `model`, two `messages` (`system` and `user`), and `max_tokens`. With `AI_RESPONSE_FORMAT=json_schema`, it also contains a strict `response_format` JSON schema and `provider: {"require_parameters": true}`. With `json_object`, only that simpler response format is set; `text` omits response-format enforcement, while Go still validates the result.

The system message defines:

- compose supplied SVG instances; do not invent SVG paths, prose, images, or other assets;
- interpret free text as an illustration idea;
- return `concept`, `layout`, and `items` in JSON;
- in selection, preserve the exact number of occurrences of every requested asset ID;
- use normalized positions, immutable native SVG dimensions, depth, opacity, and object roles;
- respect the format and palette, and vary the arrangement across requests.

The system message ends with catalog metadata: `id`, `name`, `description`, `variant`, `width`, `height`, `aspect`, `visualWeight`, and `centroid`. Concept receives the built-in catalog. Selection receives only the requested assets. Uploaded SVGs contribute their name and aspect ratio; the model does not see their rendered appearance or source paths.

The user message contains the request JSON, followed by the active canvas dimensions, fixed object factor, and a random `variationId`. For example:

```json
{
  "mode": "selection",
  "prompt": "",
  "assetIds": ["coin-main", "pen-main", "pen-main"],
  "palette": "violet",
  "canvasPreset": "square",
  "illustrationSize": "large",
  "seed": 7,
  "planner": "llm",
  "paletteColors": {
    "strong": "#7864d7",
    "medium": "#aa9bf0",
    "light": "#d7cdf5",
    "highlight": "#f9ecb0",
    "pink": "#f9a3aa",
    "soft": "#ffe3e1"
  }
}
```

For a text idea, `mode` becomes `concept`, `prompt` carries the user's text, and `assetIds` is empty. Current layer transforms, local project IDs/history, raw SVGs, raster images, and the user's IP are not included in the model messages.

The output budget is `max(5000, number_of_requested_instances * 200 + 1000)` tokens. A concept request has no requested instances and uses 5000. The JSON schema limits concept plans to 12 items and selection plans to the requested count; Go checks exact multiplicities after decoding.

## Response consumed by Go

The client expects one `choices` entry and reads its `message.content` as a JSON string. The decoded plan has this shape (illustrative format, not a live generation):

```json
{
  "concept": "A coin forms a clock face, with two pens as hands.",
  "layout": "layered",
  "items": [
    {"assetId":"coin-main","role":"focal","preferredX":0.5,"preferredY":0.5,"rotation":0,"depth":0,"opacity":1},
    {"assetId":"pen-main","role":"support","preferredX":0.52,"preferredY":0.4,"rotation":0,"depth":1,"opacity":1},
    {"assetId":"pen-main","role":"support","preferredX":0.6,"preferredY":0.5,"rotation":0,"depth":2,"opacity":1}
  ]
}
```

`layout` is one of `diagonal`, `cluster`, `arc`, `editorial`, or `layered`. Positions are normalized canvas centers. Objects retain their active original viewBox dimensions with one common factor of 1. There is no `relativeSize` or per-layer `scale` in the accepted contract. Objects may extend beyond the frame; Go does not shrink them to fit. Rotation must always be 0, including recomposition and briefs requesting tilt. Only manual editor actions can change it; recomposition preserves manually edited angles. Nonzero model angles are ignored by the server and client; depth runs back to front. Roles are `focal`, `support`, or `decor`.

Go validates IDs, counts, numerical values, roles, and opacity. It optimizes positions without changing native sizes and returns a version-2 scene to the browser. For rearrangement, the browser applies layout transforms/order while preserving original layer IDs, visibility, opacity, and lock flags. The exported SVG is assembled locally from the original vectors, not received from the provider.

An invalid plan may trigger one repair call containing the validation error. Each dispatched call consumes the shared main-model quota. Provider errors are not retried automatically; a truncated response (`finish_reason: length`) is treated as invalid. Provider token-usage and billing fields are not currently extracted by this client.
