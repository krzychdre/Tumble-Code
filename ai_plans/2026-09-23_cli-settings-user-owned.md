# CLI: `~/.roo/cli-settings.json` is written only by the user

**Status:** done on `refactor/cli-settings-user-owned` (branch 2 of 4, stacked on
`fix/cli-flag-defaults-shadow-settings`)
**Related plans:** `2026-08-04_cli-bare-run-settings-sync.md` (introduced both writers removed here),
`2026-09-23_cli-flag-defaults-shadow-settings.md`
**Touched:** `apps/cli/src/commands/cli/run.ts`, `apps/cli/src/commands/cli/__tests__/run.test.ts`,
`apps/cli/README.md`, `src/extension.ts`, `src/core/webview/ClineProvider.ts`,
`src/__tests__/extension.spec.ts`, removed `src/utils/cliSettingsMirror.ts` and its spec

## Why

The user wants one configuration file for the CLI that they write once. Before this branch
two programs rewrote `provider`, `model` and `baseUrl` in that file behind their back:

1. **The CLI itself** (`run.ts`, the `pendingSettings` block) saved the provider, model and
   base URL of every run that passed them as flags. A one-off `--model X` experiment became
   the new default.
2. **The extension** (`src/utils/cliSettingsMirror.ts`) copied its active provider profile
   into the file at every activation (`src/extension.ts`) and on every profile save or
   switch (`ClineProvider.upsertProviderProfile` / `activateProviderProfile`). The user's
   real VS Code has 18 provider profiles (read from `state.vscdb`, key `QUB-IT.tumble-code`).
   Switching VS Code to e.g. `OpenAI Sol` would have rewritten the CLI default to
   `openai-codex` / `gpt-5.6-sol`. The extension code also runs inside the CLI process, so
   a mode switch there activating a mode-bound profile wrote that profile into the file too.

Asked who besides them may write the file, the user chose "nobody". The only remaining
writer is the first-run onboarding, which records `onboardingProviderChoice` once.

## Checked and refuted on the way

Hypothesis: the in-process extension mirror reverts a hand edit on the next CLI run (it
mirrors at activation, possibly before the CLI's settings reach it). Probe with an isolated
`HOME`: shim `global-state.json` with model `MODEL-FROM-PREVIOUS-RUN`, settings file with
`MODEL-I-TYPED-BY-HAND`, one `tumble -p` run. The file was rewritten (pretty-printed) but
kept `MODEL-I-TYPED-BY-HAND`. Refuted; the removal rests on writers 1 and 2 above.

## Change

- `run.ts`: the persist block is gone; `saveSettings` is no longer imported. Resolution
  (flags > settings > shim state > defaults) is unchanged, including decision A3 (a model
  saved for another provider is never sent to the active one).
- Extension: `cliSettingsMirror.ts`, its spec, the activation hook and both
  `ClineProvider` call sites are removed.
- README: new "Settings File" section (who writes it, keys, precedence).

## Tests

`run.test.ts` persistence tests are replaced by their opposites: a bare run and a run with
`--provider/--model/--base-url/-r` both leave the file byte-identical (content and mtime)
while the host still receives the flag values; `--provider tumble` creates no file; a
`--base-url` for a provider without a base-url field exits with the provider's error.
Against the previous `run.ts` four of these fail; with the change all 27 pass.
`src`: `core/webview`, `core/config` and `extension.spec.ts` suites pass (628 + 94 tests).
