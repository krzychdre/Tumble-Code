# Provider small dedupes (Codex OAuth, Qdrant URL and marker, timeout description, attribution headers)

Status: done (branch `refactor/provider-small-dedupes`, one commit per part), simplification round 2 item C14.

## Touched files

- a: `src/integrations/openai-codex/oauth.ts`, new `src/integrations/openai-codex/__tests__/oauth.refresh.spec.ts`
- b: `src/services/code-index/vector-store/qdrant-client.ts`, new `.../__tests__/qdrant-url.spec.ts`,
  `.../__tests__/qdrant-client.spec.ts`, `qdrant-client.wire.spec.ts`, `qdrant-client.document-prefix.spec.ts`
- c: `src/package.nls*.json` (18 files)
- d: `src/api/providers/constants.ts`, `src/api/providers/utils/image-generation.ts`,
  `src/services/code-index/embedders/openrouter.ts` and their specs (`constants`, `openai`, `openrouter`,
  embedder `openrouter`, `image-generation`)
- `.changeset/provider-small-dedupes.md`

## a. Codex OAuth

Problem: `getAccessToken` (oauth.ts:490-541 on origin/main) and `forceRefreshAccessToken` (397-438) held the same
de-duplicated refresh, persist, invalid-grant cleanup; `exchangeCodeForTokens` and `refreshAccessToken` (226-330)
built the same form POST.

Fix: `postTokenForm(fields)` (module function) and `refreshAndPersist(credentials, forced)` (private method).
`forced` only selects the log wording, which is kept word for word. `getAccessToken` used to return
`this.credentials.access_token` after `saveCredentials`, which sets `this.credentials` to the new credentials, so
returning `newCredentials.access_token` is the same value.

Tests: `oauth.refresh.spec.ts` was written and run green against the old code first: form fields, URL, headers
and signal of both requests; error messages (`Token exchange failed: ...`, `Token refresh failed: ...` with
`status` and `errorCode`); one request for concurrent `getAccessToken` callers; persistence; invalid grant clears
the credentials, 500 keeps them and the next call retries, for both entry points; no credentials, no request.

## b. Qdrant

Problem: URL normalisation spread over the constructor (125-185), `parseQdrantUrl` (195-222) and
`parseHostname` (224-232); `markIndexingComplete` / `markIndexingIncomplete` (782-845) duplicated the upsert;
`"User-Agent": "Roo-Code"` twice.

Fix: exported pure `normalizeQdrantUrl(input)` returning `{ url, connection }` (the URL shown in messages and the
QdrantClient host/https/port/prefix, or `{ url }` for the last-resort fallback); `writeIndexingMarker(complete)`;
`QDRANT_USER_AGENT = "Tumble-Code"`. Nothing reads the user agent: Qdrant ignores it, and no code in the repo
(cloud API included) matches on it.

Tests: `qdrant-url.spec.ts` is a 25-row table. The rows were recorded by a throwaway probe spec that built
`QdrantVectorStore` with the old code for each input and printed `qdrantUrl` and the QdrantClient arguments; the
table then runs against the new pure function. The existing constructor tests (now expecting "Tumble-Code") and
the wire spec against a fake server still pass. New marker test pins the full upsert request for both states
(`started_at` vs `completed_at`, zero vector, `wait: true`).

Kept quirk (identical behaviour was the brief): input that starts with "http" and has a colon but no scheme,
such as `httpbin.org:8080`, is passed through and parses with the scheme `httpbin:` (empty host). The table row
documents it; fixing it is a one-line follow-up if wanted.

## c. apiRequestTimeout description

Problem: all 18 `package.nls*.json` named Moonshot (honours the timeout since it extends
`BaseOpenAiCompatibleProvider`, which passes `this.timeoutMs` to the client) and Poe (retired). The part
"(directly or through the Vertex AI platform)" was English in every locale, and the range used an en dash.

Checked in `src/api/providers`: `timeoutMs` / `getApiRequestTimeout` are read by the Anthropic, Anthropic Vertex,
OpenAI-compatible base (DeepSeek through OpenAI, Moonshot, MiniMax, Z.ai), LM Studio, OpenAI, OpenAI Native,
Codex, OpenRouter, router providers (LiteLLM), Qwen Code and xAI handlers. Not read by Bedrock (fixed 10-minute
abort), Gemini and Vertex (Gemini), Mistral, native Ollama and VS Code LM. The list now says exactly that, with
the Gemini parenthesis translated and "1-3600".

## d. Attribution headers

Problem: three different upstream referers (`RooVetGit/Roo-Cline` in `DEFAULT_HEADERS`, `RooVetGit/Roo-Code`
twice in `image-generation.ts`, `RooCodeInc/Roo-Code` in the OpenRouter embedder).

Fix: `APP_ATTRIBUTION_HEADERS` in `src/api/providers/constants.ts` with `HTTP-Referer:
https://github.com/krzychdre/Tumble-Code` and `X-Title: Tumble Code` (already the title everywhere);
`DEFAULT_HEADERS`, both image-generation requests and the embedder spread it. `User-Agent: RooCode/<version>` in
`DEFAULT_HEADERS` is unchanged (not part of this item).

## Gates

Specs: `integrations/openai-codex/__tests__/`, `api/providers/__tests__/openai-codex.spec.ts`,
`services/code-index/` (707 tests), `constants`, `openai`, `openrouter`, embedder `openrouter`,
`image-generation`, `generateImageTool`, `user-visible-brand`. `tsc --noEmit` src, eslint, prettier, knip.
