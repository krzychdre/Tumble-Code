# Ship only the tree-sitter grammars the extension can load

Status: done on `chore/build-copy-registered-grammars` (simplification round 2, item B2). No build was run (the
worktree shares `node_modules` and `src/dist` with the live tree); the copy logic is covered by the
`packages/build` spec that calls `copyWasms` into a temporary directory.

## Touched files

- `src/services/tree-sitter/grammar-wasms.json` (new): the grammar list the build ships.
- `packages/build/src/esbuild.ts`: `copyWasms(srcDir, distDir, treeSitterGrammars)` copies only the listed grammars.
- `src/esbuild.mjs`, `apps/vscode-nightly/esbuild.mjs`: read the JSON and pass it to `copyWasms`.
- `src/services/tree-sitter/languageGrammars.ts`: comment pointing to the JSON.
- `src/services/tree-sitter/__tests__/grammarWasms.spec.ts` (new): the JSON matches the grammar table.
- `src/__tests__/dist_assets.spec.ts`: expected grammars come from the table instead of a hand list.
- `packages/build/src/__tests__/pdf-worker.spec.ts`: the existing `copyWasms` run also checks the grammar set.
- `knip.jsonc`: `tree-sitter-wasms` is now a used dependency (the new spec resolves it), so the ignore entry goes.
- `.changeset/build-copy-registered-grammars.md`

## Problem

`packages/build/src/esbuild.ts:146-159` copied every `*.wasm` in `tree-sitter-wasms/out` into `dist`. The grammar
table `TREE_SITTER_GRAMMARS` (`src/services/tree-sitter/languageGrammars.ts`) loads 28 grammars; tree-sitter-wasms
ships 35. The 7 that nothing loads: bash, elm (ABI 12, rejected by web-tree-sitter 0.25), json (`.json` uses the
javascript grammar), objc, ql, rescript, yaml. `src/__tests__/dist_assets.spec.ts` pinned their presence.

## Size saved (from `src/node_modules/tree-sitter-wasms/out`, tree-sitter-wasms 0.1.x)

| file                      | bytes      |
| ------------------------- | ---------- |
| tree-sitter-objc.wasm     | 7 708 264  |
| tree-sitter-bash.wasm     | 1 400 214  |
| tree-sitter-rescript.wasm | 677 948    |
| tree-sitter-ql.wasm       | 544 940    |
| tree-sitter-yaml.wasm     | 182 936    |
| tree-sitter-elm.wasm      | 148 886    |
| tree-sitter-json.wasm     | 5 961      |
| **total**                 | 10 669 149 |

About 10.2 MiB of 50.9 MB of grammar WASMs (21%), uncompressed. The VSIX is a zip, so the saving in the download is
smaller than that, but the installed extension directory shrinks by the full amount.

## Fix

The grammar list cannot be imported by `packages/build` (the build package must not depend on the extension sources,
and a relative import from a src spec into `packages/build` is rejected by the
`boundaries/no-relative-import-outside-package` lint rule). So the list is a plain JSON data file next to the
grammar table; both build scripts (release and nightly) read it and pass it to `copyWasms`, and a src spec asserts
that the JSON equals the set of `wasm` names in `TREE_SITTER_GRAMMARS` and that each one exists in
tree-sitter-wasms. ocaml and tlaplus stay (they are in the table).

## Tests

- `packages/build` (all specs, 23 passed): the `copyWasms` run now asserts that exactly the listed grammars plus
  `tree-sitter.wasm` land in dist (it would have found 35 grammars before).
- src: `grammarWasms.spec.ts`, `dist_assets.spec.ts`, `extensionMap.realWasm.spec.ts` green.
- tsc (src, packages/build), eslint, prettier, knip exit 0.

## Notes / caveats

- Adding a grammar now needs two edits (table and JSON); the spec fails until both agree.
- An existing local `src/dist` keeps the 7 old files until the next clean build; nothing loads them.
