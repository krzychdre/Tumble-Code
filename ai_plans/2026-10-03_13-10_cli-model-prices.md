# CLI: model prices in cli-settings.json

Status: done on `feat/cli-model-prices`

## Problem (evidence)

A signed-in CLI run reaches Tumble Code Cloud, but every task shows a cost of $0.

- `~/.roo/cli-settings.json` runs `provider: "openai"`, `model: "GLM-5.3-NVFP4"`; its `models` entry has only
  `contextWindow`.
- `toProviderSettings` built `openAiCustomModelInfo` from `openAiModelInfoSaneDefaults`, whose `inputPrice` and
  `outputPrice` are 0, plus the context window. No price could be configured.
- `TaskStreamProcessor` sends `LLM Completion` with `cost: tokens.total ?? costOf(streamModelInfo, tokens)`; an
  OpenAI-compatible server reports no `total`, so the cost comes from those zero prices.

The VS Code settings fill the same `openAiCustomModelInfo` with `inputPrice`, `outputPrice`, `cacheReadsPrice`,
`cacheWritesPrice` (OpenAICompatible.tsx), which is why the extension shows a cost and the CLI does not.

## Fix

- `CliModelSettings` gains the four prices (USD per million tokens, ModelInfo names).
- `toProviderSettings` takes the whole model entry (`modelSettings`) instead of `contextWindow` and writes every
  set field into `openAiCustomModelInfo`; still `null` when nothing is set, so a stale price does not survive in
  the persisted extension state.
- `ExtensionHostOptions.contextWindow` became `modelSettings`.
- `findModelSettingsProblems` rejects a price that is not a finite number >= 0.
- The startup warning for an entry on a non-openai provider lists the keys it ignores.
- `supportsPromptCache` is left alone: it makes the openai handler add Anthropic-style `cache_control` markers,
  and the cost function charges cache reads and writes whenever the server reports them anyway.

## Touched files

- `apps/cli/src/types/types.ts`, `apps/cli/src/lib/utils/model-settings.ts`, `apps/cli/src/lib/utils/provider-config.ts`
- `apps/cli/src/agent/extension-host.ts`, `apps/cli/src/commands/cli/run.ts`
- tests: `model-settings.test.ts`, `provider-config.test.ts`, `run.test.ts`
- `apps/cli/README.md` ("Prices per model"), `.changeset/cli-model-prices.md`

## Not done

- The TUI footer still shows no cost; only the JSON output and the cloud carry it.
