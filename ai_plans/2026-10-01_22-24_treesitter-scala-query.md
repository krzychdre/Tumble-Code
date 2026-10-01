# Scala files use the Scala tree-sitter query

Status: done on `fix/treesitter-scala-query` (simplification round 2, item A1).

## Touched files

- `src/services/tree-sitter/languageGrammars.ts`
- `src/services/tree-sitter/__tests__/extensionMap.realWasm.spec.ts`
- `src/services/code-index/shared/supported-extensions.ts` (comment only)
- `.changeset/treesitter-scala-query.md`

## Problem

`src/services/tree-sitter/languageGrammars.ts:77` mapped `scala: { wasm: "scala", query: luaQuery }` with the comment
"Temporarily uses the Lua query until a Scala query is implemented". A Scala query has existed for a long time in
`queries/scala.ts`, but only the tests used it.

The effect is worse than "wrong definitions": the Lua query names node types that the Scala grammar does not have, so
compiling it fails. With the new regression test and the old table:

```
QueryError: Bad node name 'function_definition_statement'
 ❯ getQuery services/tree-sitter/languageParser.ts
 ❯ loadRequiredLanguageParsers services/tree-sitter/languageParser.ts:139
 ❯ parseSourceCodeDefinitionsForFile services/tree-sitter/index.ts:147
```

So every definitions listing of a `.scala` file (the only production caller is the folded file context written during
condensing, `src/core/condense/foldedFileContext.ts:105`) threw instead of listing anything.

Why the tests never noticed:

- `parseSourceCodeDefinitions.scala.spec.ts` and `inspectScala.spec.ts` build their own parser and pass `scalaQuery`
  in by hand (helpers.ts mocks `loadRequiredLanguageParsers`), so they never read the production table.
- `extensionMap.realWasm.spec.ts` "every advertised extension ... has a loadable grammar" skips fallback-chunked
  extensions, and `.scala` is in the code index `fallbackExtensions` precisely because of this workaround
  (its comment said "uses fallback chunking instead of Lua query workaround").

## Fix

Map `scala` to `scalaQuery`.

## Tests

New case in `extensionMap.realWasm.spec.ts` (real loader, real WASM from `src/dist`, production table): a small Scala
file must list `object Greeter`, `trait Shape`, `class Circle ...` and `def greet ...`. It fails with the QueryError
above on the old table and passes after the fix.

Run: `extensionMap.realWasm.spec.ts`, `parseSourceCodeDefinitions.scala.spec.ts`, `inspectScala.spec.ts`,
`languageParser.spec.ts` and all of `services/code-index` (714 tests, all green).

## Notes / caveats

- The code index still chunks `.scala` by length (`fallbackExtensions`). Switching it to tree-sitter chunks is a
  separate behaviour change (different chunk shapes, needs its own check against real Scala projects), so it is left
  out; only the stale comment was corrected. Follow-up candidate.
