# R4 day wave: Gemini 4 Argon, Gemini 3.8 Flash and Vertex 3.5 Flash-Lite in the model tables

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md`,
`ai_plans/2026-10-24_01-10_r4-fu-gemini-vertex-shut-down-models.md` (the removal of shut-down models that listed
these as not yet added).

## Touched files

- `packages/types/src/providers/gemini.ts`, `packages/types/src/providers/vertex.ts`
- `packages/types/src/__tests__/__fixtures__/claude-model-tables.json` (Vertex key order)

## Sources (all read 2026-10-24)

- Gemini API models index: https://ai.google.dev/gemini-api/docs/models
- Gemini API model pages: https://ai.google.dev/gemini-api/docs/models/gemini-4-argon,
  https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash,
  https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite,
  https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite
- Gemini API pricing (Standard, paid tier): https://ai.google.dev/gemini-api/docs/pricing
- Gemini API thinking levels table ("Controlling thinking"): https://ai.google.dev/gemini-api/docs/thinking
- Gemini API deprecations: https://ai.google.dev/gemini-api/docs/deprecations
- Vertex (Gemini Enterprise Agent Platform) model pages:
  https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/4-argon,
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash,
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-6-flash,
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite
- Vertex model lifecycle: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions
- Vertex pricing (global endpoint): https://cloud.google.com/vertex-ai/generative-ai/pricing (redirects to
  `cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing`; fetched with curl, the crawler is
  blocked by the page's bot check)

## Added to the Gemini table

| Field             | `gemini-4-argon`                                        | `gemini-3.8-flash`                                   |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| Stability         | Stable (models index, model page)                       | Stable (models index, model page)                    |
| Context window    | 1,048,576, shared by input and output (model page)      | 1,048,576 input (model page)                         |
| Max output tokens | 65,536 synchronous; more only with long decode (page)   | 65,536 (model page)                                  |
| Image input       | yes (model page: text, image, video, audio, PDF)        | yes (model page)                                     |
| Thinking          | levels low, medium, high; default medium (thinking)     | levels low, medium, high; default medium (thinking)  |
| Input / output    | $2 / $10 through 2026-11-30, then $4 / $20 (pricing)    | $0.75 / $3.75 through 2026-12-31, then $1.50 / $7.50 |
| Cache read        | $0.10 through 2026-11-30, then $0.20; implicit only     | $0.075 through 2026-12-31, then $0.15 (pricing)      |
| Cache storage     | none: explicit caching is not supported (pricing, page) | $0.50/h through 2026-12-31, then $1.00/h (pricing)   |

The tables store the current (promotional) prices and name the end date in the description and the comment, as the
3.6 and 3.7 Flash entries already do. `cacheWritesPrice` of 3.8 Flash is 1.0, the same value as the 3.6 and 3.7
Flash entries (the post-promotion storage price); the cost calculation of the Gemini handler does not read it.
Gemini 4 Argon has no `cacheWritesPrice` because it has no explicit caching. Neither model lists `minimal`: the
3.8 Flash page says `minimal` returns an error, and the Vertex Argon page says `MINIMAL` and a thinking budget
return HTTP 400, hence `supportsReasoningBudget: false`. A saved `minimal` effort is already mapped to a supported
level by `src/api/transform/reasoning.ts` (the same path as `gemini-3.1-pro-preview`).

The 3.7 Flash description no longer calls it the newest model: the deprecations page says the endpoint routes to
`gemini-3.8-flash`.

## Added to the Vertex table (spread from the Gemini entries)

| Id                      | Vertex launch stage and retirement (model page, lifecycle page) |
| ----------------------- | --------------------------------------------------------------- |
| `gemini-4-argon`        | GA, released 2026-10-13, retirement 2027-10-13 or later         |
| `gemini-3.8-flash`      | GA, released 2026-09-02, retirement 2027-09-02 or later         |
| `gemini-3.5-flash-lite` | GA, released 2026-07-21, retirement 2027-07-21 or later         |

Context window, output limit, image input and thinking levels on the Vertex pages match the Gemini entries (the
Vertex Argon page lists 1,048,576 maximum output tokens, which is the long-decode limit; a single synchronous
request stops at 65,536). The Vertex global prices match the Gemini API prices: Argon $2 / $10, cached $0.10
through 2026-11-30; 3.8 Flash $0.75 / $3.75, cached $0.075 through 2026-12-31; 3.5 Flash-Lite $0.30 / $2.50, cached
$0.03. Non-global endpoints cost 10% more, which the table does not model for any Gemini entry.

## Not added

- `gemini-3.1-flash-lite` (Gemini and Vertex): the Gemini API announces its shutdown on 2027-05-07 with
  `gemini-3.5-flash-lite` (already listed) as the replacement.
- `gemini-2.5-flash-lite` (Gemini): the current thinking page documents it only through thinking levels, so the
  thinking-budget limits that a 2.5 entry needs cannot be confirmed from an official page. Vertex retired it on
  2026-10-20.
- `gemini-3.6-flash` and `gemini-3.7-flash` on Vertex: retirement dates 2026-11-19 and 2027-01-28 are already
  announced, and 3.8 Flash is listed.
- Live, TTS, transcription, image, video, embedding, robotics and agent models: not chat models.

## Defaults

Unchanged. The Gemini default `gemini-3.1-pro-preview` has no shutdown date and no recommended replacement on the
deprecations page; the Vertex default is a Claude model.

## Tests

- `packages/types` suite (818 tests), fixture `claude-model-tables.json` updated for the Vertex key order.
- `src`: `gemini.spec.ts`, `vertex.spec.ts`, `vertex-model-family-characterization.spec.ts` (runs every Vertex id,
  so the three new ones too), `gemini-wire-characterization.spec.ts`, `reasoning.spec.ts`.
- `webview-ui`: `useSelectedModel.resolution.spec.ts`, `providerModelConfig.spec.ts`; CLI `context-window.test.ts`;
  `packages/core` `cost.spec.ts`.
- No new capability flag, so no new spec. Mutation: dropping `low` from the 3.8 Flash effort list turns the
  Vertex stand-in test ("a thinking level every listed Gemini takes") red.

## Notes

- `LiteLLMHandler.isGeminiModel` (`src/api/providers/lite-llm.ts`) matches only `gemini-3` and `gemini-2.5`, so a
  LiteLLM model named `gemini-4-argon` gets no thought-signature injection. Outside this change's scope.
- The 2.5 Pro and 2.5 Flash cache-read prices in the Gemini table (0.31 and 0.075) are older than the pricing page
  (0.125 and 0.03). Outside this change's scope.
