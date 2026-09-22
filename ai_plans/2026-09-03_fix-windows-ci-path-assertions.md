# Fix: Windows CI, POSIX path assertions in five spec files (14 of 22 failures)

Date: 2026-09-03
Branch: `fix/windows-ci-path-assertions` (off `main` at c09c6494c)
Sibling: `ai_plans/2026-09-03_fix-windows-ci-task-spec-system-prompt-spy.md` covers the
remaining 8 failures (`Task.spec.ts`).

## Symptom

After PR #160 (sequential isolated forks) the Windows leg of `code-qa.yml`
(`platform-unit-test (windows-latest)`, `pnpm test`) still fails: 22 tests in 6 files.
14 of them, in 5 files, fail deterministically and have never passed on Windows
(all five files postdate the June 2026 Windows fixes; last commits e084402ad,
f97ee4cf7, 07eab42b9). They are not flakes and not timeouts.

## Root cause (with evidence)

Every one of the 14 assertions compares a path the product built with Node's
`path` module (which on win32 emits backslashes and, for `path.resolve`, a drive
letter) against a POSIX string literal written in the test.

| File                                                                       | Failing assertion                                                                                                     | Product side                                                                                                         | Windows value                                                                                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/__tests__/delegation-concurrent.spec.ts` (3 tests)                    | `seedOnDisk` seeds the in-memory fs map under the literal key `` `/tmp/test-storage/tasks/${id}/history_item.json` `` | `TaskHistoryStore.withRecordTransaction` reads `path.join(path.join(tasksDir, taskId), GlobalFileNames.historyItem)` | `\tmp\test-storage\tasks\parent-task\history_item.json`: map miss, `readTaskFileResult` reports "missing", `atomicReadAndUpdate` throws `read failed for parent-task: file not found` |
| `src/core/context-management/__tests__/executionSnapshot.spec.ts:241`      | `expect(stat).toHaveBeenCalledWith("/repo/src/a.ts")`                                                                 | `executionSnapshot.ts` calls `stat(path.resolve(cwd, subject))`                                                      | `D:\repo\src\a.ts`                                                                                                                                                                    |
| `src/core/memory/__tests__/paths.spec.ts:62`                               | `expect(getMemoryBaseDir()).toBe("/custom/mem/")`                                                                     | `validateMemoryPath` returns `path.normalize(x) + path.sep`                                                          | `\custom\mem\`                                                                                                                                                                        |
| `src/core/memory/__tests__/paths.spec.ts:146`                              | `validateMemoryPath("/")` must throw                                                                                  | product gap, see below                                                                                               | does not throw                                                                                                                                                                        |
| `src/core/memory/__tests__/sharedMemory.spec.ts:122,142,163`               | `toContain(GLOBAL_STORAGE)` where `GLOBAL_STORAGE = "/home/user/.vscode/ext-storage"`                                 | `getAutoMemPath` builds `path.join(base, "projects", slug, "memory") + path.sep`                                     | `\home\user\.vscode\ext-storage\memory\projects\...`; the forward-slash literal is not a substring                                                                                    |
| `src/core/plan-review/__tests__/planReviewPause.spec.ts:81,96,103,112,120` | `toHaveBeenCalledWith("/ws/plans/plan.md", ...)`                                                                      | `planReviewPause.ts` uses `path.resolve(task.cwd, toolRelPath)`                                                      | `D:\ws\plans\plan.md`                                                                                                                                                                 |

Why they pass on Linux and macOS: on POSIX `path.join`/`path.resolve` of a
`/`-rooted input is the identity, so literal and product value coincide.

### The one real product gap: `validateMemoryPath("/")` on win32

`src/core/memory/paths.ts` rejects the filesystem root only on POSIX:

```ts
if (process.platform === "win32") {
	if (/^[a-zA-Z]:[\\/]$/.test(normalized)) throw ...   // "C:\" only
} else {
	if (normalized === path.sep || normalized.length < 3) throw ...
}
```

On win32 `path.isAbsolute("/")` is `true` (root of the current drive) and
`path.normalize("/")` is `"\"`, which is neither a drive root nor checked, so a
bare root is accepted as a memory directory. The test name says "on posix" but
the input is legal and dangerous on Windows too (memory writes would land in the
root of the current drive). The win32 branch now also rejects the bare
separator and near-root strings, which is what the POSIX branch already did.

## Fix

Tests build the expected value with the same `path` call the product uses, so
the assertion holds on every platform:

- `delegation-concurrent.spec.ts`: `seedOnDisk` keys the map with
  `path.join(STORAGE_BASE, "tasks", item.id, "history_item.json")`.
- `executionSnapshot.spec.ts`: `path.resolve("/repo", "src/a.ts")`.
- `paths.spec.ts`: `path.normalize("/custom/mem") + path.sep`; the root test is
  renamed to "rejects filesystem root" (no longer POSIX-only).
- `sharedMemory.spec.ts`: `toContain(path.join(GLOBAL_STORAGE, "memory"))`,
  which is the isolated layout's real prefix on every platform.
- `planReviewPause.spec.ts`: one `PLAN_ABS = path.resolve("/ws", "plans/plan.md")`
  constant.
- `paths.ts`: the root check is platform-independent (drive root on win32 plus
  the bare separator / near-root check everywhere).

## Verification

- The five spec files pass on Linux (`cd src && npx vitest run <files>`).
- The Windows values in the table were derived from Node's documented win32
  `path` semantics; the CI run of the branch is the platform confirmation.

## Historia

- 2026-09-03: analiza i poprawka.
