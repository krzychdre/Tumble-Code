# CLI: provider settings per mode (`modes` in `cli-settings.json`)

**Status:** done on `feat/cli-per-mode-provider-settings` (branch 4 of 4, stacked on
`feat/cli-settings-api-key`)
**Related plans:** `2026-09-23_cli-settings-api-key.md` (the resolver this extends),
`2026-09-23_cli-settings-user-owned.md`
**Touched:** `packages/types/src/vscode-extension-host.ts`, `src/core/webview/ClineProvider.ts`,
`src/core/webview/webviewMessageHandler.ts`,
`src/core/webview/__tests__/ClineProvider.cliModeProviderSettings.spec.ts` (new),
`apps/cli/src/commands/cli/run.ts`, `apps/cli/src/agent/extension-host.ts`,
`apps/cli/src/lib/utils/provider-config.ts`, `apps/cli/src/types/types.ts`, `apps/cli/src/ui/App.tsx`,
`apps/cli/src/ui/hooks/useExtensionHost.ts`, tests, `apps/cli/README.md`

## Request

"Configuration that sets provider, URL, model and reasoning effort globally and lets me
change the settings/model per mode." Decisions (user): entries override only what they
name and inherit the rest; any provider flag makes the run use one configuration for all
modes.

## What was happening on a mode switch in the CLI

The CLI configured the extension only through flat settings (`updateSettings`). A mode
switch goes through `ClineProvider.handleModeSwitch`, which activates the provider profile
the extension's own profile store binds to the new mode. The CLI never configures that
store, so the bindings are whatever an earlier session left. On this machine every mode
(`architect`, `code`, `ask`, `debug`, `orchestrator`) was bound to profile `default` =
`openai-codex` / `gpt-5.6-sol` (read from `~/.vscode-mock/global-storage/secrets.json`).

Reproduced with the installed CLI (current `main` behaviour), an isolated `HOME` seeded
with that profile envelope (no secrets copied) and a fake OpenAI-compatible server that
answers the first request with `switch_mode` to `architect`:

```
tumble --provider openai --api-key 1111 --base-url http://127.0.0.1:18111/v1 --model GLM-5.3-Flash-NVFP4 -p "switch to architect"
requests: 1 (GLM-5.3-Flash-NVFP4); exit 1
debug log: "Not authenticated with OpenAI Codex. Please sign in using the OpenAI Codex OAuth flow."
cli-settings.json afterwards: provider "openai-codex", model "gpt-5.6-sol" (written by the since-removed mirror)
```

With a logged-in Codex (the user's real setup) the task would have continued silently on
`gpt-5.6-sol` instead of the local GLM.

## Design

- **Settings:** `modes: { [slug]: { provider?, model?, baseUrl?, apiKey?, apiKeyEnv?, reasoningEffort? } }`.
  Each entry is resolved by `resolveProviderConfig` with the file's top level as the layer
  below, so the provider-bound rules of branch 3 apply: an entry naming another provider
  inherits no model, base URL or key.
- **Flags:** if any of `--provider/--model/--base-url/--api-key/--reasoning-effort` is
  given, `modes` is ignored for that run and every mode uses flags-on-top-of-top-level.
- **Startup:** the session starts with the entry of its start mode. Every configuration
  the run can switch to is validated before the host starts (invalid provider, Codex
  login, base URL support, missing key / unset `apiKeyEnv`, reasoning effort), and errors
  name the entry (`modes.debug in ~/.roo/cli-settings.json: No API key provided ...`).
- **Transport:** the CLI sends `{ base, modes }` (extension `ProviderSettings`) once, right
  after the initial `updateSettings`, as the new `cliModeProviderSettings` webview message.
  It is always sent, also without entries, so no mode can fall back to a stored profile.
- **Extension:** `ClineProvider` keeps it in memory (`setCliModeProviderSettings`). While
  set, `modes[mode] ?? base` replaces the profile store in the three places that map a
  mode to provider settings:
    1. `handleModeSwitch` (user `/mode`, `switch_mode`, slash-command modes, `new_task`
       delegation): `setProviderSettings` + forced handler rebuild, no store reads or writes;
    2. `getApiConfigurationForMode` (mode-scoped subagents);
    3. `createTaskWithHistoryItem` (resume, and a parent returning from its subtask).
       Nothing is persisted, so the mapping is recomputed from the file on every start
       (transient over persisted, per the mode-switching design rule).
- **TUI:** the footer model, and the banner on ctrl+o reprints, follow the extension state
  (`summarizeProviderSettings`, reading the active provider's own model field, because the
  state can hold a stale `apiModelId` next to the live `openAiModelId`). The TUI path
  forwards the new host option explicitly, as it does `baseUrl`.

## Verification (real build, fake server, isolated HOME)

New build, no flags, settings with `modes.architect = { model: GLM-5.3-NVFP4, reasoningEffort: high }`:

```
1 GLM-5.3-Flash-NVFP4  Authorization: Bearer 1111   (code)
2 GLM-5.3-NVFP4        Authorization: Bearer 1111   (after switch_mode to architect)
exit 0; cli-settings.json unchanged
```

## Tests

- `ClineProvider.cliModeProviderSettings.spec.ts` (7): mode entry applied without touching
  the store, base fallback, settings the new mode leaves out are cleared, the current
  task's handler is rebuilt, store behaviour unchanged without CLI settings, subagent
  resolution, resume in the task's own mode. With the three call sites disabled, 6 fail.
- `run.test.ts` (+7): inheritance, provider switch inherits nothing provider-bound, start
  mode entry, base always sent, flags force one configuration, broken entries fail at
  startup naming the mode.
- `provider-config.test.ts` (+4): `toProviderSettings`, `summarizeProviderSettings`.

## Found, not fixed here

- **`reasoningEffort` has no effect on the `openai` provider from the CLI.**
  `shouldUseReasoningEffort` (`src/shared/api.ts:75`) ignores a settings-only effort unless
  the model info declares support; for `openai` that info is `openAiCustomModelInfo`,
  which the CLI never sets, so `openAiModelInfoSaneDefaults` applies (no reasoning flag,
  128k context window, while the user's VS Code profile says 1,048,576). Live check: `max`
  and `high` both sent `thinking: {type: enabled}` and no `reasoning_effort`. True before
  this stack as well; needs a way to declare model info in the settings.
- **The TUI drops `consecutiveMistakeLimit`, `terminalShell` and `exitOnError`**
  (`App.tsx` / `useExtensionHost.ts` forward a hand-picked subset of host options).
