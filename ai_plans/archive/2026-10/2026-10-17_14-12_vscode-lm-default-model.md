# VS Code LM: no default model, retired families removed

**Status:** implemented on `fix/vscode-lm-default-model`
**Related plans:** `ai_plans/2026-10-17_12-23_vertex-bedrock-default-model.md` (listed VS Code LM under "reported, not fixed")
**Touched:**

- `packages/types/src/providers/vscode-llm.ts` (`vscodeLlmDefaultModelId = ""`, `VscodeLlmModelId` removed,
  `vscodeLlmModels` reduced to `gpt-5-mini`)
- `src/package.nls*.json` (18 files, family example `gpt-4` -> `gpt-5-mini`), example comments in
  `src/api/providers/vscode-lm.ts`
- tests: `packages/types/src/__tests__/provider-validation.spec.ts`,
  `webview-ui/src/hooks/models/__tests__/useSelectedModel.resolution.spec.ts`

## Problem

`vscodeLlmDefaultModelId = "claude-3.5-sonnet"`. GitHub Copilot retired Claude Sonnet 3.5 on 2025-11-06
(retirement table on https://docs.github.com/en/copilot/reference/ai-models/supported-models, read 2026-10-17).

## What the default actually did

Traced every reader:

- The handler never reads it. `VsCodeLmHandler.createClient` calls `vscode.lm.selectChatModels(selector)` with
  the saved selector or `{}` and takes `models[0]`; `getModel()` reports the live client.
- `useSelectedModel` (settings and chat info) showed `claude-3.5-sonnet` and its static 81k context window when
  no selector was saved, a model the request did not run.
- `providerModelDefinitions["vscode-lm"].defaultModelId` feeds `resolveProviderFormModelId` and
  `getProviderDefaultModelId`; the form ignores the selector field for model rules.
- The validation registry already requires `vsCodeLmModelSelector`, and `provider-validation.spec.ts` had to
  exclude vscode-lm from "a model id is required exactly when there is no default model" because of this
  constant.

So any current model id would be just as wrong (the settings cannot know which model `models[0]` is). The
default becomes `""`, like ollama, lmstudio and openai; the spec exclusion is gone.

## Static model table

Of the 15 families, only GPT-5 mini is still offered by Copilot (GA, so "(Preview)" is dropped from its name).
All others are in Copilot's retirement table or absent from the supported list. The table now holds only
`gpt-5-mini`. A selector for any other family shows `openAiModelInfoSaneDefaults` in the settings, as an unlisted
family already did; the request uses the live model limits either way. New families were not added: the Copilot
docs give product names, not the `family` strings or `maxInputTokens` that VS Code reports, and those could not
be verified here.

## Noticed, not changed

A saved selector for a retired family makes `selectChatModels` return `[]`, and `createClient` then builds a stub
model whose only answer is "Language model functionality is limited. Please check VS Code configuration." The
user gets no error naming the missing model.

## Tests

`packages/types` 807 (vscode-lm now in the required-model rule), webview `src/hooks/models` +
`src/components/settings` 906, `src/api/providers/__tests__/vscode-lm.spec.ts` 22, `tsc --noEmit` in types,
webview-ui, src, cli.
