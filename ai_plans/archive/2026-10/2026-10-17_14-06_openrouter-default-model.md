# OpenRouter: default to Claude Opus 5

**Status:** implemented on `fix/openrouter-default-model`
**Related plans:** `ai_plans/2026-10-17_12-23_vertex-bedrock-default-model.md` (listed OpenRouter under "reported, not fixed")
**Touched:**

- `packages/types/src/providers/openrouter.ts` (`openRouterDefaultModelId`, `openRouterDefaultModelInfo`, new
  module-private `openRouterUnknownModelInfo`, new `openRouterFallbackModelInfo(id)`)
- `packages/types/src/provider-model-selection.ts`, `src/api/providers/openrouter.ts` (both resolvers use
  `openRouterFallbackModelInfo`)
- `apps/cli/src/types/constants.ts` (`DEFAULT_FLAGS.model` follows `openRouterDefaultModelId`), `apps/cli/README.md`
- tests: `src/api/providers/__tests__/openrouter.spec.ts`, `packages/types/src/__tests__/provider-model-resolution.spec.ts`

## Problem

- Extension: `openRouterDefaultModelId = "anthropic/claude-sonnet-4.5"`. Sonnet 4.5 retires on 2026-11-30.
  Anthropic, Vertex and Bedrock already default to Claude Opus 5 (owner decision in the related plan).
- CLI: `DEFAULT_FLAGS.model = "anthropic/claude-opus-4.6"`, a second, independent OpenRouter default, so
  `tumble` without `--model` and the extension ran different models.

## The default info was also the unknown-model stand-in

`openRouterDefaultModelInfo` was used for every id missing from the fetched model list
(`models[id] ?? openRouterDefaultModelInfo`), and for every id while the list is not fetched yet or could not be
fetched. Filling it with Opus 5 info alone would have given an unknown GPT or Gemini id `supportsTemperature:
false` and the Claude 5 reasoning toggle. Same decision as Vertex and Bedrock ("standin"):

- `openRouterDefaultModelInfo`: Opus 5, in the shape `parseOpenRouterModel` gives `anthropic/claude-opus-5`
  once the list is fetched (maxTokens 128k, 1M context, $5/$25/$6.25/$0.50, reasoning budget + binary toggle,
  no temperature).
- `openRouterUnknownModelInfo`: the old Sonnet-4.5-sized record without a description; only its info is used.
- `openRouterFallbackModelInfo(id)` picks one of the two. An empty id (`openRouterModelId: ""`, sent as is)
  gets the stand-in, since it is not the default id.

The stand-in is not exported: an export used only by tests fails the `find-test-only-exports` gate.

## Behaviour change for existing users

Profiles without a saved OpenRouter model id move from Sonnet 4.5 to Opus 5 (more expensive, thinking on by
default). Saved ids are not changed. CLI users without `--model` and without a saved model move from Opus 4.6
to Opus 5.

## Tests

- `openrouter.spec.ts`: the default id not yet in the fetched list gets `openRouterDefaultModelInfo`, no
  temperature, maxTokens 8192 (reasoning off); a new case: an unknown `openai/...` id keeps temperature 0 and
  gets no Claude 5 fields.
- `provider-model-resolution.spec.ts`: unknown and empty ids expect the stand-in.
- Ran: `packages/types` (806), webview `src/hooks/models` + `ApiOptions.spec.tsx` (183), CLI `src/lib/utils` +
  `src/types` (304), `tsc --noEmit` in types, src, cli.
