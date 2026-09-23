# CLI TUI: forward every extension-host option (three were silently dropped)

**Status:** fixed on `fix/cli-tui-forwards-all-host-options` (branch 5, stacked on
`feat/cli-per-mode-provider-settings`)
**Related plans:** `2026-08-04_cli-bare-run-settings-sync.md` (bug 3: the same path once dropped `baseUrl`),
`2026-09-23_cli-per-mode-provider-settings.md` (found there)
**Touched:** `apps/cli/src/ui/App.tsx`, `apps/cli/src/ui/hooks/useExtensionHost.ts`,
`apps/cli/src/ui/hooks/__tests__/useExtensionHost.test.tsx` (new)

## Symptom

`consecutiveMistakeLimit` in `~/.roo/cli-settings.json` (and `--consecutive-mistake-limit`,
`--terminal-shell`, `--exit-on-error`) had no effect in the interactive TUI; they worked
only with `--print`.

## What was happening

`run.ts` builds a complete `ExtensionHostOptions` and passes it to `App` as props. `App`
destructured a hand-picked list of fields and passed them to `useExtensionHost`, which
destructured its own hand-picked list and rebuilt the object for `createExtensionHost`.
`consecutiveMistakeLimit`, `terminalShell` and `exitOnError` were in neither list, so the
host fell back to its defaults (`DEFAULT_FLAGS.consecutiveMistakeLimit` = 10, no custom
shell, retry instead of exit). The same pattern dropped `baseUrl` in August (bug 3 of the
settings-sync plan), and branch 4 had to add `modeProviderSettings` to both lists by hand.

## Fix

Both layers now separate only their own fields (`initialPrompt`, `initialTaskId`,
`initialSessionId`, `continueSession`, `version`, the callbacks) and pass the rest through
as one object: `createExtensionHost({ ...hostOptions, disableOutput: true })`. A new host
option reaches the host without touching the TUI.

## Tests

`useExtensionHost.test.tsx` renders the hook with a full option set and expects the
factory to receive exactly those options plus `disableOutput: true`. Against the previous
hook it fails (the three options are missing); with the fix it passes.
