# The CLI runs each mode on its VS Code profile

Status: done, merged as #1368.

## Problem

Second part of the owner's request that the CLI works the same as VS Code (first part: #1365, the settings). The
owner chose that profiles and models come too, without API keys, and that the user's own keys in
`cli-settings.json` win.

The CLI resolved the provider from flags, the file and, as the bottom layer, its own extension state in
`~/.vscode-mock` (`readVsCodeConfig`). The editor's profiles, their mode bindings and the model facts stored in a
profile (an OpenAI-compatible profile's context window of 1,048,576 tokens, its reasoning effort) never reached it.

## Fix

- Extension: `VscodeSection.profiles` is `ProviderSettingsManager.export()` (the "Export settings" envelope, no API
  keys); the mirror also writes after `context.secrets.onDidChange`, where profiles are stored.
- CLI `lib/utils/vscode-profiles.ts`: `readVscodeProfiles` parses the envelope with `providerProfilesEnvelopeSchema`
  (undefined, with a warning in run.ts, when another extension version wrote a shape it cannot read) and gives
  `forMode(mode)`: the profile bound to the mode, else the current one, as a connection (provider, model, base URL)
  and model facts in `CliModelSettings` terms (context window, prices, images from `openAiCustomModelInfo`,
  preserve/trim reasoning, reasoning effort, model size, hide MCP, concurrent requests). Retired providers and
  providers the CLI does not run are skipped.
- `run.ts` `resolveOnProfile`: the mode's profile connection replaces the `~/.vscode-mock` fallback, keeping that
  store's key only for the same provider. When the resolved connection is exactly the profile's, the profile's model
  facts ride along as `profileModelSettings`; `modelSettingsFor` puts the `models` entry over them field by field.
  Modes bound in VS Code join the per-mode configurations, so a mode switch in the CLI follows them.
- README (Settings File), docs/architecture.md.

## Tests

`cliSettingsMirror.spec.ts` (profiles carried without the key, written after a profile change, real
`ProviderSettingsManager` on an in-memory secret store), `vscode-profiles.test.ts`, `run.test.ts` (modes on their
profiles with model facts, `models` entry wins per field, file provider wins, stored key only for its provider);
shared fixture `vscode-profiles-envelope.ts`; mutation-checked.
