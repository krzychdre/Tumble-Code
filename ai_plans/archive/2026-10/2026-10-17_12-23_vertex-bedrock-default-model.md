# Vertex and Bedrock: default to Claude Opus 5

**Status:** implemented on `fix/vertex-bedrock-default-model`, not pushed, not merged
**Related plans:** `ai_plans/2026-10-17_12-16_bedrock-effort-model-default.md` (Bedrock effort handling, merged
as #899 before this branch was rebased onto it)
**Touched:**

- `packages/types/src/providers/vertex.ts` (`vertexDefaultModelId`, new `vertexUnknownModelStandInId`)
- `packages/types/src/providers/bedrock.ts` (`bedrockDefaultModelId`, new `bedrockUnknownModelStandInId`)
- `packages/types/src/provider-models.ts` (optional `unknownModelInfoId` on a provider model definition, read by
  `resolveCatalogModel` for an unknown id)
- `src/api/providers/bedrock.ts` (unknown-id fallback in `getModelById` reads the stand-in, one line)
- tests: `packages/types/src/__tests__/provider-model-resolution.spec.ts`,
  `src/api/providers/__tests__/vertex.spec.ts`, `src/api/providers/__tests__/bedrock.spec.ts`,
  `webview-ui/src/hooks/models/__tests__/useSelectedModel.resolution.spec.ts`

## Problem

Vertex defaulted to `claude-sonnet-4-5@20250929` and Bedrock to `anthropic.claude-sonnet-4-5-20250929-v1:0`.
Anthropic retires Claude Sonnet 4.5 on 2026-11-30. The direct Anthropic provider already defaults to
`claude-opus-5`. Owner decision: move both defaults to the Claude Opus 5 entry of each table.

## Change

| Provider | Old default                                 | New default               |
| -------- | ------------------------------------------- | ------------------------- |
| Vertex   | `claude-sonnet-4-5@20250929`                | `claude-opus-5`           |
| Bedrock  | `anthropic.claude-sonnet-4-5-20250929-v1:0` | `anthropic.claude-opus-5` |

Both ids exist in their tables (`vertexModels["claude-opus-5"]`, `bedrockModels["anthropic.claude-opus-5"]`,
both spread from `claudeModels["opus-5"]`).

### Bedrock inference profile prefix

The default is stored as the bare base id, the same way the old Sonnet 4.5 default was. The handler adds the
`global.` prefix when "Use global inference" is on (Opus 5 is in `BEDROCK_GLOBAL_INFERENCE_MODEL_IDS`) or the
regional prefix (`us.`, `eu.`, ...) when "Use cross-region inference" is on. Sonnet 4.5 also needed an inference
profile on Bedrock, so callability is unchanged: the user's existing toggle decides the prefix, nothing in the
default id has to change.

## The default was also the unknown-model stand-in

Grepping the default ids showed two places that use the default's info for a model id that is not in the table:

1. `resolveCatalogModel` with the `keep-id` policy (Vertex: an unknown Gemini id on the Gemini handler, and an
   unknown `claude-*` id on the Anthropic Vertex handler).
2. `AwsBedrockHandler.getModelById`, the unknown-id and custom-ARN branch, which spreads the default's info and
   then the family guess.

Measured with a probe spec before the fix (old default vs new default):

- Vertex, `gemini-1.5-pro-001`: maxTokens 40000 to 128000, context 200k to 1M, $3 to $5, and a new
  `thinkingConfig: { thinkingLevel: "high" }` sent to a Gemini model that may reject it; `completePrompt`
  stopped sending temperature (Opus 5 has `supportsTemperature: false`). The existing spec
  "should complete prompt successfully for Gemini" failed on this.
- Bedrock, `mistral.some-new-model-v1:0` or an `imported-model` ARN: temperature 0.3 to omitted, input price $3
  to $5, and Opus 5 effort support (`supportsReasoningEffort`, `reasoningEffort: "high"`) inherited by a
  non-Claude model.

Owner decision ("standin"): keep Claude Sonnet 4.5 as the info stand-in for unknown ids on both providers. Only
its info is used, never its id, so the retirement does not matter for it (the same pattern as the existing
`bedrockDefaultPromptRouterModelId`, which also stays on Sonnet 4.5). `ProviderModelDefinition` gained an
optional `unknownModelInfoId`; `resolveCatalogModel` uses it for an unknown id when set, otherwise the default as
before. Every other provider is unchanged.

## Places that depend on the defaults

- (a) Code meaning "the default", follows the new id: `providerModelDefinitions.vertex/bedrock.defaultModelId`,
  `resolveProviderFormModelId` (form model id when none is set), the empty or `custom-arn` id branch in
  `AwsBedrockHandler.getModel`, the empty-id path of `resolveCatalogModel` (requests and settings UI).
- (b) Tests asserting the default: `useSelectedModel.resolution.spec.ts` "vertex unset with 1M" pinned the
  Sonnet 4.5 literal with its 1M tier; it now expects `vertexDefaultModelId` with plain info (Opus 5 serves 1M
  natively and has no tier). `provider-model-resolution.spec.ts` "vertex unknown" now expects the stand-in.
  The specs that already use the symbol (`provider-definitions.spec.ts`, `ApiOptions.spec.tsx`,
  `providerModelConfig.spec.ts`, the unset/empty cases) follow it without edits.
- (c) Tests that use Sonnet 4.5 only as a sample model id (about 20 Bedrock and Anthropic specs, the CLI
  `context-window.test.ts`, the Claude table fixture, `BedrockCustomArn.tsx` placeholder ARN): left alone.

## Behaviour change for existing users

Users of Vertex or Bedrock who never saved a model id (or saved an empty one, or chose "custom ARN" without an
ARN) silently move from Claude Sonnet 4.5 to Claude Opus 5. Opus 5 is more expensive: $5 input / $25 output per
million tokens, against $3 / $15 for Sonnet 4.5 (cache writes $6.25 vs $3.75, cache reads $0.50 vs $0.30). Its
thinking is on by default at effort "high". Users with a saved model id, including a saved Sonnet 4.5 id, are
not affected. Users with an unknown id keep the Sonnet 4.5 stand-in info as before.

## Other providers with a deprecated Claude default (reported, not fixed)

- OpenRouter: `openRouterDefaultModelId = "anthropic/claude-sonnet-4.5"`, with matching hardcoded
  `openRouterDefaultModelInfo` (Sonnet 4.5 description and prices).
- VS Code LM: `vscodeLlmDefaultModelId = "claude-3.5-sonnet"` (a Claude 3.5 model), in a model list that is
  itself old.
- LiteLLM defaults to `claude-sonnet-5-5` (current) and Anthropic to `claude-opus-5` (current).
- `bedrockDefaultPromptRouterModelId` stays on Sonnet 4.5: it is a priced stand-in for a prompt router, not a
  model that is called.

## Pre-existing quirk noticed, not changed

With no model id set, Vertex picks the Gemini handler (`isVertexClaudeModel` reads `apiModelId`, which is unset)
but runs the default Claude id on it. This was true for Sonnet 4.5 too and is pinned by the "vertex unset with
1M" case in `provider-model-resolution.spec.ts`.

## Tests

- `provider-model-resolution.spec.ts`: "vertex unknown" expects the stand-in info; new "vertex unknown claude"
  case for the Anthropic Vertex path.
- `vertex.spec.ts`: new case, unknown Gemini id keeps maxTokens 40000, temperature 1, no reasoning.
- `bedrock.spec.ts`: new cases for an unknown id and an imported-model ARN: temperature 0.3, no effort fields,
  input price 3.
- `useSelectedModel.resolution.spec.ts`: "vertex unset with 1M" follows `vertexDefaultModelId`.
