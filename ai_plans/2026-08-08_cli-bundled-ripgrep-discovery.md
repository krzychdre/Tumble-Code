# CLI bundled ripgrep discovery

## Root cause

The packaged CLI wrapper exposes its bundled ripgrep binary through `ROO_RIPGREP_PATH`, but the extension's shared ripgrep resolver only searches relative to `vscode.env.appRoot`. During OpenAI Codex startup, extension initialization can observe the bundled CLI module directory as `appRoot`, so all app-root-relative candidates miss even though `bin/rg` exists and is executable.

## Changes

1. Make `getBinPath()` prefer a valid absolute `ROO_RIPGREP_PATH` supplied by the CLI wrapper.
2. Keep all existing VS Code app-root candidate layouts as fallbacks.
3. Add a regression test proving the explicit packaged-CLI path wins independently of `appRoot`.

## Verification

- `cd src && npx vitest run services/ripgrep/__tests__/index.spec.ts` — 10 tests passed.
- `./apps/cli/scripts/build.sh --install` — extension/CLI build, temporary installation checks, and local installation passed.
- Installed bundle contains the `ROO_RIPGREP_PATH` resolver branch, its wrapper exports the absolute executable path, and `bin/rg` is executable.
- Installed OpenAI Codex smoke task completed with `OK`; no `Could not find ripgrep binary` error occurred.
- The first post-fix installation was stale: its installed extension hash differed from the newly rebuilt tarball and contained no `ROO_RIPGREP_PATH` marker. Installing the current tarball corrected that artifact skew.
