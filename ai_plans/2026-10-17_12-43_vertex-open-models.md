# Vertex: drop the open (MaaS) models the Gemini path cannot call

**Status:** implemented on `fix/vertex-open-models`, not pushed, not merged
**Related plans:** `ai_plans/2026-10-17_12-23_vertex-bedrock-default-model.md` (the unknown-model stand-in that
a saved id now falls back to); a parallel branch `refactor/vertex-model-family` reworks Vertex model family
selection, so this branch only deletes table entries and does not touch the stand-in constants.
**Touched:**

- `packages/types/src/providers/vertex.ts` (8 entries deleted from `vertexModels`)
- `packages/types/src/__tests__/__fixtures__/claude-model-tables.json` (the same 8 ids deleted from the
  `vertex.order` list)
- `packages/core/src/api/__tests__/cost.spec.ts` (comment that named the MaaS ids)

## Problem

The Vertex table listed open "model as a service" (MaaS) models next to Gemini and Claude:

- `llama-4-maverick-17b-128e-instruct-maas`
- `deepseek-r1-0528-maas`
- `deepseek-v3.1-maas`
- `gpt-oss-120b-maas`
- `gpt-oss-20b-maas`
- `qwen3-coder-480b-a35b-instruct-maas`
- `qwen3-235b-a22b-instruct-2507-maas`
- `moonshotai/kimi-k2-thinking-maas`

`isVertexClaudeModel` only checks for the `claude` prefix, so the runtime registry sends all of them to
`VertexHandler`, which is `GeminiHandler` with `@google/genai` in Vertex mode. Nothing ever special-cased them:
the three commits that added them (c6a29f3f2, 18cf33f96, a060915d1, inherited from upstream) only touched the
types table (and one region in a webview spec).

## Evidence that the requests could never work

### What the SDK sends

`@google/genai` 2.24.0, `dist/node/index.cjs`, `tModel()`: in Vertex mode an id without a slash becomes
`publishers/google/models/<id>`, and `a/b` becomes `publishers/a/models/b`. The handler then calls
`models.generateContentStream`, so the path is `{model}:streamGenerateContent?alt=sse`.

A probe spec with the real SDK and only `fetch` faked (same technique as
`gemini-wire-characterization.spec.ts`) recorded, for example:

```
https://us-central1-aiplatform.googleapis.com/v1beta1/projects/p/locations/us-central1/publishers/google/models/deepseek-r1-0528-maas:streamGenerateContent?alt=sse
https://us-central1-aiplatform.googleapis.com/v1beta1/projects/p/locations/us-central1/publishers/moonshotai/models/kimi-k2-thinking-maas:streamGenerateContent?alt=sse
```

with a Gemini body (`contents`, `systemInstruction`, `tools[].functionDeclarations`, `generationConfig`).
Seven of the eight ids are also filed under the wrong publisher (`google` instead of `meta`, `deepseek-ai`,
`openai`, `qwen`).

### What Vertex documents

- https://cloud.google.com/vertex-ai/generative-ai/docs/maas/call-open-model-apis (now
  docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/call-open-model-apis): "Many open models
  ... offer fully managed and serverless models as APIs using the ... Chat Completions API", with
  `POST https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/LOCATION/endpoints/openapi/chat/completions`
  and an OpenAI body whose `model` is e.g. `deepseek-ai/deepseek-v3.1-maas`.
- The Llama page (partner-models/llama/use-llama) sends `"model": "meta/MODEL"` to the same endpoint; the Kimi
  and Qwen pages say "To learn how to make streaming and non-streaming calls ... see Call open model APIs".
- The function calling page for open models uses the same OpenAI `tools` / `tool_choice` shape.

No page documents `generateContent` for these models. So the Gemini path requests a resource that does not
exist, in a protocol the models are not served on.

## Decision

Owner rule: if making them work needs a new request path (an OpenAI-compatible Vertex handler with Google auth),
remove the entries instead of keeping dead ones. Done.

## Saved ids

Vertex uses `unknownModelPolicy: "keep-id"` with the `vertexUnknownModelStandInId` info. A probe confirmed that
`selectVertexModel({ apiModelId: "deepseek-r1-0528-maas" })` keeps the id with the stand-in info and
`buildApiHandler` still builds a `VertexHandler`, so a profile with a saved id loads as before. Its requests fail
exactly as they failed before this change.

## Not changed

- `us-south1` stays in `VERTEX_REGIONS`: it is a general Vertex region, not specific to these models.
- No UI or i18n strings referenced these ids.

## Tests

- `packages/types`: claude-model-tables, provider-model-resolution, provider-models specs; `tsc --noEmit`.
- `packages/core`: cost.spec.
- `src`: vertex.spec, gemini-wire-characterization.spec, `api/__tests__`; `tsc --noEmit`.
- `webview-ui`: providerModelConfig.spec, useSelectedModel.resolution.spec.
