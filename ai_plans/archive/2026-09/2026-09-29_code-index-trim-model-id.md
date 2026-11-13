# Code index: stray whitespace in the model id showed "Invalid API endpoint"

## Symptom

Codebase indexing with the OpenAI Compatible embedder (`http://192.168.50.194:11111/v1`, model
`granite-embedding-311m-multilingual-r2`) failed with "Invalid API endpoint. Please check your URL
configuration." although the URL and model looked correct in the settings.

## Root cause (evidence)

- The stored `codebaseIndexConfig` in VS Code `state.vscdb` held
  `codebaseIndexEmbedderModelId: " granite-embedding-311m-multilingual-r2"` (leading space, pasted).
- The server behind :11111 is llama-swap. It answers `404 {"error":"no router for requested model"}`
  for an unknown model id, and the padded id is unknown (reproduced with curl; the same id without
  the space returns 200 and a vector).
- The OpenAI SDK turns this into `404 "no router for requested model"`. `getErrorMessageForStatus`
  mapped every non-OpenAI 404 to `invalidEndpoint`, so the message blamed the URL.
- A genuinely wrong path gives `404 page not found` (body has no "model").

## Fix

1. `config-manager.ts` trims the model id, Qdrant URL, Ollama base URL and OpenAI Compatible base
   URL on load, so an already stored padded value works without re-entering it.
2. `messageHandlers/codeIndex.ts` trims the same fields on save, so the settings field shows the
   clean value.
3. `getErrorMessageForStatus` receives the error message; a 404 whose body mentions `model`
   reports `modelNotAvailable` instead of `invalidEndpoint`.

## Tests

- `config-manager.spec.ts`: padded model id and URLs load trimmed.
- `validation-helpers.spec.ts`: llama-swap model 404 -> modelNotAvailable; plain 404 -> invalidEndpoint.
