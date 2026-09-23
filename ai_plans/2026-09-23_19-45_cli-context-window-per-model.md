# CLI: context window per model in cli-settings.json

**Status:** implemented on `feat/cli-context-window-setting` (from `main` ab901f663), committed, not pushed
**Related plans:** `2026-09-22_cli-context-gauge-in-footer.md` (the bar), `2026-09-23_cli-per-mode-provider-settings.md` (how settings reach the extension), `2026-09-23_cli-settings-api-key.md` (layered resolver)
**Touched:**
- `apps/cli/src/types/types.ts` (`CliModelSettings`, `CliSettings.models`)
- `apps/cli/src/lib/utils/model-settings.ts` (new: lookup and validation)
- `apps/cli/src/lib/utils/provider-config.ts` (`toProviderSettings` writes `openAiCustomModelInfo`)
- `apps/cli/src/commands/cli/run.ts` (size per configuration, startup error and warning)
- `apps/cli/src/agent/extension-host.ts` (`contextWindow` option)
- `apps/cli/src/lib/utils/context-window.ts` (the gauge reads what the extension reads)
- tests: `model-settings.test.ts`, `context-window.test.ts` (both new), `provider-config.test.ts`, `run.test.ts`
- `apps/cli/README.md` ("Context window per model")

## Symptom

User, 2026-09-23: "What is the context bar based on? GLM-5.3 has 262,144 and it
seems 131k is taken. Add a way to set the context size of a model in the config
file." The user's `~/.roo/cli-settings.json`: provider `openai`, model
`GLM-5.3-NVFP4`, base URL `http://192.168.50.194:11111/v1`.

## What was happening

Two different wrong sizes, neither of them the model's:

1. **The extension used 128,000.** `OpenAiHandler.getModel()`
   (`src/api/providers/openai.ts:408`) takes
   `openAiCustomModelInfo ?? openAiModelInfoSaneDefaults`, and the defaults say
   `contextWindow: 128_000`. The CLI never sets `openAiCustomModelInfo`; the
   user's `~/.vscode-mock/global-storage/global-state.json` holds only
   `apiProvider`, `openAiModelId` and `openAiBaseUrl`. With `maxTokens: -1`
   the reserve is -1, so `allowedTokens = 128000 * 0.9 + 1 = 115,201`
   (`src/core/context-management/index.ts:350`): the conversation is condensed
   once the context passes 115,201 tokens.
2. **The footer bar used 200,000.** `getContextWindow` looks the model up in
   `routerModels[provider][model]` and falls back to `DEFAULT_CONTEXT_WINDOW`
   (200,000). For `openai` the CLI requests the `openai-compatible` model source,
   whose adapter (`src/api/providers/fetchers/modelSourceRegistry.ts:67`)
   returns `modelIds` only, and `useMessageHandlers` stores a result only when it
   has `models`. So `routerModels` never holds an openai size and the bar always
   divided by 200,000.

So the user's "131k" guess was close to the extension's 128,000 but the bar was
showing yet another denominator.

## Evidence (live, fake OpenAI-compatible server)

`/tmp/roo-ctx-e2e/fake_openai.py`: the main loop gets `list_files` three times
with reported prompt sizes 30k, 60k and 120k tokens, then `attempt_completion`;
a request whose system prompt is the condensing prompt gets a summary. Isolated
`HOME`, the installed extension bundle (`~/.roo/cli/extension`).

Print mode (`run.sh`), what the extension did:

| Build and settings | Requests | Condensed |
| --- | --- | --- |
| this branch, no `models` entry | 3 main + 1 condense + 1 main | yes, `prevContextTokens 120203` |
| this branch, `contextWindow: 262144` | 4 main | no |
| same HOME, entry removed again | 3 main + 1 condense + 1 main | yes; stored size cleared (`None`) |

Interactive TUI (`tui.sh`, footer percentages read from the pty output):

| Build and settings | Bar readings |
| --- | --- |
| installed CLI (main) | 15%, 30%, 60%, then 9% after condensing |
| this branch, no entry | 23%, 47%, 94%, then 15% after condensing |
| this branch, `contextWindow: 262144` | 11%, 23%, 46% |

On main the bar read 60% at the moment the extension condensed.

## Design

- **Key: `models`, keyed by model id** (`{"GLM-5.3-NVFP4": {"contextWindow": 262144}}`),
  not a top-level `contextWindow`. A size belongs to a model, and a model can
  run from the top level, a `modes` entry or `--model`; a flat key would need
  rules for which of those it follows. The map needs none, and the object leaves
  room for more per-model facts. Exact, case-sensitive id match.
- **Only the openai provider.** It is the only provider with a model-info field
  in `ProviderSettings` (`openAiCustomModelInfo`); the others size their models
  from their own tables. A `models` size for a model that some configuration of
  the run uses on another provider prints one warning per model and provider
  and is otherwise ignored, so the bar and the condensing never disagree.
- **What is sent:** `openAiCustomModelInfo = { ...openAiModelInfoSaneDefaults, contextWindow }`,
  so every other field (maxTokens -1, images, prices 0) is exactly what the
  extension used before. Without an entry the field is sent as `null`, not left
  out: the startup `updateSettings` is merged key by key into the persisted
  extension state (`webviewMessageHandler.ts` `case "updateSettings"` calls
  `contextProxy.setValue` per key), so an absent key would keep a size from an
  earlier run. The third print-mode run above shows the clearing.
- **Where it is sent:** the startup settings (`ExtensionHostOptions.contextWindow`
  through `toProviderSettings(this.options)`) and every entry of
  `modeProviderSettings`, which a mode switch, a mode-scoped subagent and a
  resumed task apply through `setProviderSettings`.
- **The bar** reads `apiConfiguration.openAiCustomModelInfo?.contextWindow ?? openAiModelInfoSaneDefaults.contextWindow`
  for `openai`, the same expression as `OpenAiHandler.getModel()`, from the
  state the extension pushes. It does not read the settings file itself.
- **Validation:** a size that is not a whole number above 0, or an entry that is
  not an object, stops the run at startup and names `models.<id>.contextWindow`.

## Tests

- `model-settings.test.ts`: exact-id lookup; valid maps; bad values named with
  the value shown (`"262k"`, 0, -1, 1.5); non-object map and entry.
- `provider-config.test.ts`: `toProviderSettings` sizes an openai model on top
  of the defaults, sends `null` without a size, and adds nothing for anthropic.
- `context-window.test.ts`: the openai size from `openAiCustomModelInfo`, the
  provider's 128,000 default (not 200,000) without it, router lookup unchanged
  for other providers. Verified by disabling the new branch: both openai tests
  fail with `expected 200000 to be 262144` / `expected 200000 to be 128000`.
- `run.test.ts`: the size reaches the session, the base and a mode on the same
  model, while a mode on another model gets `null`; `--model` picks its entry; a
  malformed size stops the run and names the model; an anthropic model with an
  entry warns once and sends no model info. The existing exact-match test of
  `modeProviderSettings` now expects `openAiCustomModelInfo: null`.
- Full CLI suite: 83 files pass (2 runs).

## Notes

- Not checked live: a mode switch to a mode whose model has its own size. It
  goes through the same `modeProviderSettings` path that the per-mode branch
  verified live for model and reasoning effort, and `run.test.ts` covers what
  is sent.
- Other providers still get the bar's 200,000 fallback when `routerModels`
  has no entry (static providers such as `zai` or `anthropic`), while the
  extension uses their model tables. Same class of bug, separate fix: the CLI
  would need the static model tables the webview's `useSelectedModel` uses.
- `reasoningEffort` for the openai provider is still a no-op in the CLI, for
  the related reason recorded in `2026-09-23_cli-per-mode-provider-settings.md`
  (it needs `openAiCustomModelInfo.supportsReasoningEffort`). The field now
  exists in what the CLI sends, but this branch deliberately sets only the size.
