# D8 — Merge `ShadowCheckpointService` and `RepoPerTaskCheckpointService`

Roadmap item D8 from `ai_plans/2026-09-27_simplification-roadmap.md`:
"**Abstract class with one subclass**: `ShadowCheckpointService` (553 lines) and its 15-line `RepoPerTaskCheckpointService`." → Merge into one class.

Branch: `refactor/d8-merge-checkpoint-service` (off main @ `066939443`).

## What the subclass actually differs in

`RepoPerTaskCheckpointService` (src/services/checkpoints/RepoPerTaskCheckpointService.ts, 15 lines) overrides **nothing**. Its entire content is one static factory:

```ts
public static create({ taskId, workspaceDir, shadowDir, log = console.log }: CheckpointServiceOptions) {
    return new RepoPerTaskCheckpointService(
        taskId,
        path.join(shadowDir, "tasks", taskId, "checkpoints"),
        workspaceDir,
        log,
    )
}
```

I.e. it exists only to compute the per-task checkpoints directory
`<shadowDir>/tasks/<taskId>/checkpoints` — which is byte-identical to the abstract
parent's `protected static taskRepoDir()` (src/services/checkpoints/ShadowCheckpointService.ts:472-474),
a method with zero external callers. No behavior difference, no config difference
beyond the directory path the factory passes to the constructor. This is
purely polymorphism-as-boilerplate.

## Consumer inventory (before)

| Consumer                                                                                                    | What it uses                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/core/checkpoints/index.ts:18,114,135                                                                    | imports `RepoPerTaskCheckpointService` from the barrel; `getCheckpointService()` calls `.create(options)`; `checkGitInstallation(task, service, …)` types the param |
| src/core/task/Task.ts:82,433                                                                                | imports `RepoPerTaskCheckpointService`; `checkpointService?: RepoPerTaskCheckpointService` field type                                                               |
| src/core/webview/TaskHistoryGateway.ts:13,551                                                               | imports `ShadowCheckpointService` directly; calls static `ShadowCheckpointService.deleteTask(...)`                                                                  |
| src/core/webview/BackgroundTaskRunner.ts:252                                                                | comment-only mention                                                                                                                                                |
| src/services/checkpoints/index.ts:3                                                                         | barrel re-exports `RepoPerTaskCheckpointService`                                                                                                                    |
| src/services/checkpoints/**tests**/ShadowCheckpointService.spec.ts:13,82,89,347,468,506,1063,1067,1099,1107 | imports `RepoPerTaskCheckpointService` (class + `BLOCKED_ENV_KEYS` from `ShadowCheckpointService`); `describe.each` instantiates via both `.create()` and `new`     |
| src/core/checkpoints/**tests**/checkpoint.test.ts:58,107-108,431-432                                        | `vi.mock("../../../services/checkpoints")`; mocks/inspects `RepoPerTaskCheckpointService.create`                                                                    |
| src/core/webview/**tests**/TaskHistoryGateway.spec.ts:8,25-26                                               | mocks `ShadowCheckpointService.deleteTask`                                                                                                                          |
| src/core/webview/**tests**/ClineProvider.taskHistory.spec.ts:14,1268,1306,1328                              | spies on static `ShadowCheckpointService.deleteTask`                                                                                                                |

Also inside ShadowCheckpointService.ts itself: `this.constructor.name` in log
strings (fine — concrete class name shows up the same or better) and the unused
`taskRepoDir` static.

## Design

Keep the name **`ShadowCheckpointService`** — it describes the mechanism (shadow
git repo), `RepoPerTask` describes a directory-layout detail that is now just the
`create()` factory's path computation. `ShadowCheckpointService` is also the name
already imported by TaskHistoryGateway and its specs, and the file name stays, so
the deepest import path (`services/checkpoints/ShadowCheckpointService`) is
untouched.

Changes:

1. `ShadowCheckpointService` drops `abstract` and gains the static
   `create({ taskId, workspaceDir, shadowDir, log = console.log })` factory
   (moved verbatim from the subclass). No constructor changes — the factory IS
   the "config as parameter" form; no polymorphism remains to parameterize.
2. Delete `protected static taskRepoDir()` (dead — zero callers; the factory
   computes the same path inline). `workspaceRepoDir()` stays (used by
   `deleteTask`).
3. Delete `RepoPerTaskCheckpointService.ts`.
4. Barrel (src/services/checkpoints/index.ts): export `ShadowCheckpointService`
   instead.
5. Update import sites:
    - src/core/checkpoints/index.ts → `ShadowCheckpointService.create(...)`, param type
    - src/core/task/Task.ts → import + field type
6. Specs: rename imports/usages only; assertions unchanged. The `describe.each`
   wrapper in ShadowCheckpointService.spec.ts collapses to the single class
   (kept as a trivial one-element `each`? No — simplified to a plain `describe`,
   since the second class no longer exists; the test bodies and assertions are
   untouched). checkpoint.test.ts mock target becomes
   `ShadowCheckpointService.create`.

Observable behavior identical: same constructor signature, same `create()`
signature (`CheckpointServiceOptions`), same statics (`hashWorkspaceDir`,
`deleteTask`, `deleteBranch`, `BLOCKED_ENV_KEYS`), same events.

## Verification

- `cd src && npx vitest run services/checkpoints/__tests__/ShadowCheckpointService.spec.ts`
- `cd src && npx vitest run core/checkpoints/__tests__/checkpoint.test.ts`
- `cd src && npx vitest run core/webview/__tests__/TaskHistoryGateway.spec.ts core/webview/__tests__/ClineProvider.taskHistory.spec.ts`
- typecheck + eslint on touched files
- `pnpm knip` — no new findings (baseline exit 1 pre-existing)

## Notes / residuals

- Log strings using `this.constructor.name` previously printed
  `RepoPerTaskCheckpointService` for the instantiated service; after the merge
  they print `ShadowCheckpointService`. Log-only, not observable behavior.
- `deleteTask`'s branch naming (`roo-${taskId}`) is a legacy on-disk format and
  is intentionally untouched.
- docs/architecture.md and docs/06-persistence.md were checked; neither
  documents the class pair or the subclass split (no doc update needed).
