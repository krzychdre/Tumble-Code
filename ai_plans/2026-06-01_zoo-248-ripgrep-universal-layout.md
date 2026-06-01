# Zoo PR #248 — Locate ripgrep in the @vscode/ripgrep-universal layout

- **Upstream:** Zoo-Code #248, commit `1629d8a33`, merged 2026-05-24, author 0xMink.
- **Branch:** `feature/zoo-248-ripgrep-universal-layout` (off `main`).
- **Credit:** `Co-authored-by: 0xMink <260166390+0xMink@users.noreply.github.com>`.

## Problem

Recent VS Code builds (notably the Insiders staged-install layout, see
microsoft/vscode#252063) ship ripgrep via the `@vscode/ripgrep-universal`
package, which nests the binary under `bin/<platform>-<arch>/` rather than
directly in `bin/`. `getBinPath` only probed the classic `@vscode/ripgrep` and
`vscode-ripgrep` layouts, so on those builds it returned `undefined` and search
silently broke.

The squashed PR went through a require-based attempt and a revert (the require
throws because VS Code's extHost interceptor aliases `@vscode/ripgrep` to
`@vscode/ripgrep-universal`, a package absent on un-migrated stable builds). The
net landed change is purely additional path probes — no require, matching the
fork's existing path-probe approach.

## Fix (product — `src/services/ripgrep/index.ts`)

1. Add a module constant `ripgrepUniversalBinDir = \`bin/${process.platform}-${process.arch}\``.
2. Append two more `checkPath` candidates to `getBinPath`'s fallback chain:
    - `node_modules/@vscode/ripgrep-universal/${ripgrepUniversalBinDir}`
    - `node_modules.asar.unpacked/@vscode/ripgrep-universal/${ripgrepUniversalBinDir}`
3. Refresh the doc comments (header bullet + `getBinPath` JSDoc) to describe both
   layouts and the `undefined` return — verbatim from upstream.

Reuses the existing `fileExistsAtPath` util and the `checkPath` helper; no new
deps. The fork's `getBinPath` is structurally identical to upstream, so this is a
faithful 1:1 port.

## Tests (`src/services/ripgrep/__tests__/index.spec.ts`)

Add the upstream test setup (mock `../../../utils/fs`'s `fileExistsAtPath`) and a
`describe("getBinPath")` block with 4 cases:

1. classic `@vscode/ripgrep` layout resolves;
2. `@vscode/ripgrep-universal/bin/<plat>-<arch>` layout resolves;
3. unpacked `node_modules.asar.unpacked/@vscode/ripgrep-universal/...` resolves;
4. returns `undefined` when nothing is found.

## Scope / skip

No changeset (fork port workflow omits them). Product + tests only.

## Verification

- `npx vitest run services/ripgrep/__tests__/index.spec.ts` (from `src/`).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
