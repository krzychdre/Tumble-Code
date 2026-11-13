# Drop the eight hard-skipped e2e suites (B7)

Status: done (PR open, not merged)

## Touched files

- `apps/vscode-e2e/src/suite/subtasks.test.ts` (deleted)
- `apps/vscode-e2e/src/suite/tools/*.test.ts` (7 files deleted: apply-diff, execute-command, list-files, read-file,
  search-files, use-mcp-tool, write-to-file)
- `.github/workflows/vscode-e2e.yml` (header comment no longer mentions the skipped suites)

## Problem

Each of the eight files holds exactly one top-level `suite.skip(...)` and nothing else outside it (checked: every
unindented line other than imports and the `suite.skip` call sits inside a template string). Mocha therefore never
runs any of their tests. Upstream skipped them in #8767 (6fa6c3c1e, 2025-10-22); an attempt to re-enable them
(#10720) was reverted two days later (#10794). Together they are 5,045 lines that nobody runs or maintains.

## Fix

Delete the eight files. The shared helpers they imported (`suite/utils.ts`: `waitFor`, `sleep`,
`waitUntilCompleted`; `suite/test-utils.ts`: `setDefaultSuiteTimeout`) are still used by the suites that run
(extension, task, modes, markdown-lists, providers/zai, providers/deepseek-v4), so they stay. There were no fixtures
used only by these suites: they created their test files at run time. The harness (`runTest.ts`, `suite/index.ts`)
is untouched; its glob simply finds fewer files.

## Tests

- `tsc --noEmit` with both `apps/vscode-e2e/tsconfig.json` and `tsconfig.esm.json`: pass.
- `pnpm knip`: exit 0.
- The e2e suite itself was not run (it needs a real VS Code and API keys).

## Notes

Coverage for these tools lives in the unit tests under `src/core/tools/__tests__`. If one of these workflows needs
an end-to-end check again, the deleted files are in git history at the parent of this commit.
