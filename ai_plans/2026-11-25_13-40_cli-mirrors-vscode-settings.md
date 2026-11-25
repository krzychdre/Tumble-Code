# The CLI runs with the editor's settings

Status: done, merged as #1365.

## Problem

The owner wants the VS Code configuration reflected in `~/.roo/cli-settings.json`, so the extension and the CLI
work the same. The CLI runs the same engine with its own state (`~/.vscode-mock/global-storage`); the settings file
knows about 18 keys, so every other setting of the Settings view (72 rows, 105 global settings) runs on its default
in the CLI. Example: the subtask handoff limits of #1364.

History: an earlier mirror (`src/utils/cliSettingsMirror.ts`, 2026-08-04) wrote the active profile's provider,
model and base URL into the top-level keys and was removed on 2026-09-23 (#185) after it moved the CLI to an
`openai-codex` profile and overwrote the user's keys.

Owner's decisions (2026-11-25): the extension writes one section, `vscode`, and the user's own keys win; profiles
and models come too (second branch); the editor's approvals do not (the CLI keeps `requireApproval`).

## Fix (this branch: settings)

- `src/core/config/cliSettingsMirror.ts`: `buildVscodeSection` takes every global setting that is set, except a
  table of keys that stay out (approvals, profiles and the settings that name a profile by id, VS Code's terminal
  integration, the code index, custom modes, the editor's view state and current mode); `writeVscodeSection`
  replaces only `vscode` under the file lock (`withLockedJsonTransaction`), mode 0600, and skips an unchanged
  section; `startCliSettingsMirror` writes at once and 500 ms after the last `ContextProxy.onDidChangeValues`.
  `activate()` starts it unless `ROO_CLI_RUNTIME` is set.
- CLI: `CliSettings.vscode.settings`; `ExtensionHostOptions.vscodeSettings` goes under the permission settings and
  the run's own settings (`experiments` merged, `customTools` kept on); `commandExecutionTimeout` falls back to it
  before the default. `saveSettings` reads and writes under the same lock, since two processes now write the file.
- README (Settings File) and docs/architecture.md (CLI runtime contract).

## Tests

`cliSettingsMirror.spec.ts` (keys, other keys kept, unchanged file untouched, 0600, write on change),
`extension.spec.ts` (started in VS Code, not in the CLI), CLI `extension-host.test.ts` (precedence, experiments),
`run.test.ts` (timeout fallback, section handed to the host); mutation-checked.
