# True-state audit and cleanup (2026-09-27)

**Date:** 2026-09-27
**Status:** done. Record of the audit and the cleanup performed; no code changed.

## 1. Content audit of 128 branches

Every local and remote branch was audited by content, not by ref labels. Result:

- **127 branches LANDED on main** (as of `059bac30c`).
- **1 branch intentionally unmerged:** `docs/refactor-plan-2026-09-24`, the 2026-09-24 refactor master plan
  (tip `9e8d3d833`, Phase 11 done 2026-09-26). Its outputs merged as PRs #200-#512; the plan document itself
  stays on the branch on purpose. Successor status doc:
  [`ai_plans/2026-09-27_simplification-roadmap.md`](2026-09-27_simplification-roadmap.md).

Squash merges made `git cherry`, `git log main..X` and `git branch --merged` report false negatives: a branch
whose commits were squash-merged looks unmerged to every ref-based check. Each branch was therefore verified by
content markers (grep of the branch's key changes against the main tree) with `git log -S` as a fallback. This
is the only reliable method in this repository; ref labels are not.

## 2. Done on 2026-09-27

- **Cloud api image rebuilt and redeployed** from main@`059bac30c` (image `2289ffad9c30`, healthy,
  alembic head `b4c5d6e7f8a9`). R5 and R7-R10 are live on the deployed stack; the image rebuild debt from
  PRs #534 and #536-#538 is cleared.
- **Branch cleanup:** 87 local branches deleted plus 15 dead DEF-C tracking refs pruned; origin is clean.
  Only `main` and `docs/refactor-plan-2026-09-24` remain locally.
- **VSIX + CLI:** already current. Both are builds of main@`059bac30c` from 18:51 on 2026-09-27; nothing to do.
- **Documentation cleanup (this commit):** stale "committed, not pushed" / "unmerged" / "VSIX rebuild owed"
  status headers in ~20 `ai_plans/` files corrected to "LANDED on main (content-verified 2026-09-27)";
  the simplification roadmap status table completed with the R6 and R8-R11 rows; `docs/architecture.md`
  fixed to state that the refactor plan lives on the `docs/refactor-plan-2026-09-24` branch (intentionally
  unmerged), not "on a branch that no longer exists".

## 3. Still open

- **agent-bench A/B and Z.ai cache probe** before WS-7/8 (decode x turns is the GLM bottleneck; the probe
  results gate those workstreams).
- **Run memory-writers on a weak model** (the single-shot extraction/dream rework, merged in #423, still needs
  a weak-model validation pass).
- **4 items deferred since 2026-07-12:** streaming unification, metrics memoization, usage-count audit,
  dream `lastModified`.
- **28 branches in worktrees** (`refactor/*`, `fix/*`): to be deleted after their worktrees are emptied;
  they were left alone because the worktrees may still hold in-progress state.
