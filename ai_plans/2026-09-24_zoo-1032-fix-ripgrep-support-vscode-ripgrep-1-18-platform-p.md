# Zoo #1032 port: find ripgrep in the @vscode/ripgrep >=1.18 per-platform package

**Status:** ported, one commit on the Zoo port stack.
**Upstream:** Zoo-Code PR #1032 (issue #1024), commit `d27153a25` (merged 2026-07-26),
authors edelauna, Naved Merchant.
**Touched:** `src/services/ripgrep/index.ts`, `src/core/environment/getEnvironmentDetails.ts`,
`src/services/ripgrep/__tests__/index.spec.ts`, `src/services/ripgrep/__tests__/diagnostic.spec.ts`,
`src/core/environment/__tests__/getEnvironmentDetails.spec.ts`.

## Symptom

On a VS Code build that bundles `@vscode/ripgrep` 1.18 or newer (VS Code 1.130+), the extension
cannot find the ripgrep binary. `search_files` and `list_files` fail, and because the environment
details call `listFiles` without a guard, every API request of a task fails with
"Could not find ripgrep binary".

Verified against the npm registry: `@vscode/ripgrep@1.18.0` ships only `lib/index.js` (no `bin/`)
and lists `@vscode/ripgrep-<platform>-<arch>` packages as optionalDependencies; the
`@vscode/ripgrep-linux-x64@1.18.0` tarball contains `bin/rg`. The local VS Code 1.139 on this
host still uses the `@vscode/ripgrep-universal` layout, so builds differ.

## Root cause in our code

- `src/services/ripgrep/index.ts:92-105` (`ripgrepCandidatePaths`) probes only the classic
  `@vscode/ripgrep/bin`, `vscode-ripgrep/bin` and `@vscode/ripgrep-universal` paths.
- `src/core/environment/getEnvironmentDetails.ts:311` awaits `listFiles` unguarded, and
  `src/services/glob/list-files.ts:196` throws when `getBinPath` returns undefined.

## Fix

- Two new candidates: `node_modules/@vscode/ripgrep-<platform>-<arch>/bin/rg` and the same under
  `node_modules.asar.unpacked`, placed after the existing ones. The diagnostic command
  (`tumble-code.showRipgrepDiagnostic`) reports them automatically because it iterates the same list.
- The workspace listing in the environment details is wrapped in try/catch; on failure the section
  says `(File listing unavailable: <message>)` and the rest of the details are still built.

## Tests

Before the fix, 6 new or extended tests failed: 2 `getBinPath` cases for the new layout
(returned `undefined`), 2 diagnostic cases (new candidates missing from the probe report), 2
`getEnvironmentDetails` cases (the rejection propagated). After the fix, `services/ripgrep`,
`services/glob` and `core/environment` pass 85/85; `tsc --noEmit`, eslint and prettier are clean.

## Not ported

- `process.env.npm_config_arch` in the package name. `@vscode/ripgrep` reads it at install time
  for cross-arch builds; at runtime the extension host runs the same architecture as the VS Code
  build that bundled the package, so `process.arch` is the right key and an env var inherited from
  an npm script cannot redirect the lookup.
- Zoo's test for the `npm_config_arch` override (follows from the above).
