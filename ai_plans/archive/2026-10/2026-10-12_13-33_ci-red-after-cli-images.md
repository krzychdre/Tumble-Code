# CI red on main after the CLI images round - investigation & fix

**Status:** fixed, five branches, one per cause.
**Related plans:** `2026-10-10_19-36_compact-small-model-profile.md`, `2026-10-12_13-35_security-deps-shell-quote-mcp-sdk.md`.
**Touched:**

- `scripts/test-only-exports-allowlist.mjs` (branch `fix/ci-test-only-export-inline-images`)
- `src/__tests__/single-open-invariant.spec.ts` (branch `fix/ci-single-open-invariant-subscriptions`)
- `packages/build/src/types.ts`, `packages/build/src/__tests__/index.test.ts` (branch `fix/ci-nightly-command-icon-schema`)
- `src/core/environment/getEnvironmentDetails.ts`, `src/core/environment/__tests__/getEnvironmentDetails.compact.spec.ts` (branch `fix/visible-files-posix-paths`)
- `src/core/prompts/__tests__/compact-off-golden.spec.ts`, `src/core/prompts/__tests__/compact-profile-prompt.spec.ts`, `src/core/tools/__tests__/applyDiffTool.spec.ts` (branch `fix/ci-windows-test-paths`)
- `webview-ui/package.json`, `src/package.json`, `packages/agent-interchange/package.json`, `pnpm-lock.yaml` (branch `fix/ci-audit-shell-quote-mcp-sdk`, own plan)

## Symptom

On main at `40a90b050` four workflows were red. "Code QA" had not been green since `62b90894f` (2026-10-07), "Nightly Publish" since `5e2deaed8` (2026-10-09).

| Job                                            | Failure                                                                                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code QA / knip                                 | `Test-only exports outside the allowlist (1): apps/cli/src/ui/graphics/inlineImages.ts: resetInlineImages`                                                                    |
| Code QA / platform-unit-test (ubuntu, windows) | `single-open-invariant.spec.ts > API startNewTask closes current before new task`: `TypeError: Cannot read properties of undefined (reading 'push')` at `extension/api.ts:56` |
| Code QA / platform-unit-test (windows)         | 31 more: `getEnvironmentDetails.compact.spec.ts` (2), `compact-off-golden.spec.ts` (21), `compact-profile-prompt.spec.ts` (6), `applyDiffTool.spec.ts` (2)                    |
| Nightly Publish                                | zod: `commands[0].icon` and `commands[4].icon`: `expected string, received object`                                                                                            |
| Dependency audit                               | critical GHSA-pqg4-j6r4-53mv in `shell-quote` 1.10.0, high GHSA-6qxp-vccf-f47h in `@modelcontextprotocol/sdk` 1.30.1                                                          |

The Windows log seen through `gh run view --log-failed` is truncated; the full job log came from `gh api repos/<repo>/actions/jobs/<id>/logs`.

## What was happening

1. **knip gate.** `resetInlineImages` (#856) clears the CLI's session-wide image registry between specs. No production file calls it, which is exactly the "state-reset seam" category the allowlist exists for.
2. **single-open-invariant.** Since #829 the `API` constructor pushes the `ClineProvider.observeInstances` disposable into `context.subscriptions`. The spec's provider stub had `context: {}`. A real `ExtensionContext` always has `subscriptions`, so the stub was wrong, not the code. Fails on every platform, every run.
3. **Nightly manifest schema.** `packages/build/src/types.ts` allowed only a string command icon. `src/package.json` uses `{ light, dark }` for the Open in Editor command and, since #851, for New Task too. VS Code supports both shapes.
4. **Visible files on Windows (product bug).** `getVisibleFilesText` called `.toPosix()` only in the branch without a `.rooignore` controller; `getOpenTabsText` converts right after `path.relative`. Every real task has a controller, so on Windows the model saw `src\a.ts` under Visible Files and `src/a.ts` under Open Tabs. The compact environment spec (#855) was the first test to pin a visible file.
5. **Compact prompt specs on Windows.** Both specs stub `os` as Linux and serve `MEMORY.md` from a stub keyed on `/mock/settings/path/memory/`, but `core/memory/paths.ts` joins with the native `path`. On Windows the directory became `\mock\settings\...`: the prompt text differed and the fs stub never matched, so the memory index vanished.
6. **apply_diff spec on Windows.** The `path` mock replaced only the named `resolve`; `ApplyDiffTool.ts` uses `import path from "path"`, so the real `resolve` ran. On Linux `resolve("/", "test/file.txt")` coincides with the expected `/test/file.txt`; on Windows it gives `D:\test\file.txt` against the expected `C:\test\file.txt`. The assertions on the absolute path came with #812.
7. **Audit.** Both advisories are fixed upstream; see the plan of that branch.

## Fix

1. Allowlist entry next to the other reset seams.
2. Stub `context: { subscriptions: [] }`.
3. `icon: z.union([z.string(), z.object({ light: z.string(), dark: z.string() })]).optional()`.
4. `.map((absolutePath) => path.relative(task.cwd, absolutePath).toPosix())` in `getVisibleFilesText`, plus a changeset.
5. `vi.mock("path", ...)` returning `path.posix` in both compact prompt specs, next to the `os` stub.
6. The `path` mock stubs `resolve` on the default export too.
7. `shell-quote` `^1.12.0`, `@modelcontextprotocol/sdk` `1.32.1`.

## Tests

- 1: `node scripts/find-test-only-exports.mjs --check` exits 0.
- 2: the spec failed locally every run before the fix, passes after.
- 3: `index.test.ts` now carries a themed-icon command; the schema also parses the real `src/package.json` `contributes`.
- 4: new case "gives visible files and open tabs with forward slashes, as on Windows" feeds a backslash path. Before the fix it failed on Linux with the exact Windows symptom (`Visible files: notes\coffee.md`).
- 5: swapping the stub to `path.win32` reproduced the 27 Windows failures on Linux (same diffs); with `path.posix` all 79 pass.
- 6: with `mockCline.cwd = "/elsewhere"` the old mock failed the same 2 cases (`/elsewhere/test/file.txt`); the new mock passes regardless of `cwd`.

## Notes

- Fixes 5 and 6 are test-only; the code under test was right on Windows there.
- The MCP SDK 1.32 follows HTTP redirects only within the same origin; a remote MCP URL that redirects to another host must now be configured with its final address (noted in the changeset).
