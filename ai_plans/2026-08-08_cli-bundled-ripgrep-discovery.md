# CLI bundled ripgrep discovery

## Root cause

The packaged CLI wrapper exposes its bundled ripgrep binary through `ROO_RIPGREP_PATH`, but the extension's shared ripgrep resolver only searches relative to `vscode.env.appRoot`. During OpenAI Codex startup, extension initialization can observe the bundled CLI module directory as `appRoot`, so all app-root-relative candidates miss even though `bin/rg` exists and is executable.

## Changes

1. Make `getBinPath()` prefer a valid absolute `ROO_RIPGREP_PATH` supplied by the CLI wrapper.
2. Keep all existing VS Code app-root candidate layouts as fallbacks.
3. Add a regression test proving the explicit packaged-CLI path wins independently of `appRoot`.

## Verification

- Focused ripgrep resolver tests.
- Backend type-check and lint.
- Extension bundle and CLI package build.
- Installed-layout smoke test with `appRoot` deliberately pointed at a directory without `node_modules`, proving the wrapper-provided binary is selected.
