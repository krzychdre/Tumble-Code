# CLI bundle test reads the list of tsup builds

Status: done on `fix/cli-bundle-test-config-array`
Related plans: `2026-10-12_16-10_cli-math.md` (added the MathJax build)
Touched: `apps/cli/src/lib/utils/__tests__/cli-bundle.test.ts`

## Need

Code QA on main has been red since 2026-10-12 (first seen at 41125ab94, ubuntu and windows): only
`cli-bundle.test.ts` fails, with `No input files, try "tsup <your-file>" instead` and, for the render probe,
`Top-level await is currently not supported with the "cjs" output format`.

## What was happening

#869 (fa5131ef1) turned the default export of `apps/cli/tsup.config.ts` from one build into a list of two:
the CLI and the MathJax engine. The test still spread it as one object (`...config` in `bundle()`). Spreading an
array gives `{ "0": ..., "1": ... }`, so the build had no `entry` (no input files) and no `format`; the probe set
its own entry, and tsup's default format, CommonJS, rejects the probe's top-level await.

## Change

`bundle()` takes the build whose entries include `src/index.ts` from the list (and still accepts a single
object), and throws a clear error when there is none.

## Before / after

| Run | Before | After |
| --- | --- | --- |
| `vitest run src/lib/utils/__tests__/cli-bundle.test.ts` | 2 failed, 5 skipped | 5 passed |

## Tests

The test file itself, run in a worktree off main 337663621.

## Notes

The MathJax build is not covered by this test; it bundles no render-critical package.
