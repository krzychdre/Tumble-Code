---
"tumble-code": patch
---

Running parallel subagents again from the same task no longer fails with "branch already exists". Every run gets its own worktree and branch names, so worktrees left by an earlier run (kept for review, or left behind when the run was interrupted) are never in the way.

Worktrees that a crashed or reloaded VS Code window could not clean up are now removed the next time parallel subagents start in that repository, when they hold no changes. Ones with changes stay for review, as before.
