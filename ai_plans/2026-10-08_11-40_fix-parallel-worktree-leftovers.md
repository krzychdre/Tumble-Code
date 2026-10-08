# Parallel subagent worktrees left behind, retry fails with "branch already exists"

**Status:** done (branch `fix/parallel-worktree-leftovers`)
**Touched:** `packages/types/src/worktree.ts`, `packages/core/src/worktree/worktree-service.ts`, `src/core/tools/RunParallelTasksTool.ts`, tests.

## Symptom

A task in `private-things` (parent `01a11ab3`, GLM-5.3-Flash) started 20 parallel
subagents at 10:53. Several of them hung in API retries (`api_req_retry_delayed:
terminated`). Around 11:24 the parent was interrupted and resumed, and the model
started a second fan-out of 15. The second fan-out could not create worktrees for
the indices the first run had used: the branch already existed.

On disk afterwards: 11 worktrees `~/.roo/worktrees/private-things-01a11ab3-N` on
`worktree/parallel-01a11ab3-N`, all clean, zero commits ahead of `main`. The
parent's history has no `subagents.json`, so the first fan-out never finished.

## What was happening

- `worktreeNamesFor` derived path and branch only from the parent id and the
  subtask index. Every fan-out of the same parent produced the same names.
- Cleanup (`finalize`) runs only when the worker's `runOneSubtask` reaches its
  end. When the fan-out never reaches it (interrupted parent, killed extension
  host), nothing removes the worktree, and nothing later recognises it as
  garbage.
- Worktrees kept on purpose (they hold changes) collide with a retry the same way.

## Fix

1. **Unique names per run.** `newFanOutRunId()` (base36 timestamp) is part of
   the worktree dir and the branch: `worktree/parallel-<parent8>-<run>-<n>`.
   A retry can no longer meet anything an earlier run left.
2. **Ownership lock.** Each subagent worktree is created with
   `git worktree add --lock --reason "tumble-code parallel subtask, pid <pid>"`.
   `finalize` unlocks it before the clean/empty check (git refuses a non-forced
   remove of a locked worktree), so a kept worktree is a plain one the user can
   remove.
3. **Orphan sweep.** Before a fan-out creates its worktrees,
   `sweepOrphanedSubtaskWorktrees(cwd)` lists the repo's worktrees and, for each
   lock of ours whose pid is not alive (`process.kill(pid, 0)`), unlocks it and
   removes it with its branch when clean and commitless. Locks held by a live
   process, unlocked worktrees and foreign locks are not touched, so a fan-out in
   another window or a detached fan-out in this host is safe.

The git lock was chosen over the provider's `liveSubagents()` because that list
covers one panel only; the pid in the lock works across panels and windows.

## Not covered

- Worktrees left by builds before this fix carry no lock, so the sweep does not
  know whether they are in use; they are removed by hand
  (`git worktree remove <path> && git branch -d <branch>`).
- Subagents hanging in retries after the parent was interrupted (the cause of
  the interruption in the incident) is a separate problem.

## Verification

- `RunParallelTasksTool.spec.ts`: names differ per run, worktrees are created
  locked by this pid and unlocked when the subtask ends, two runs of the same
  parent create four distinct branches, the sweep removes a dead-pid clean
  orphan, keeps a dead-pid dirty one (unlocked), ignores live/unlocked/foreign
  locks, and runs before the first `createWorktree`.
- `worktree-service.spec.ts`: `--lock --reason` arguments, `unlockWorktree`.
- Real git 2.53: locked worktree shows `locked <reason>` in porcelain, plain
  `worktree remove` is refused, `unlock` + `remove` + `branch -d` succeed.
