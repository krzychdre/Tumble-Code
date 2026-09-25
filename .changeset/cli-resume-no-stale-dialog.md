---
"tumble-code": patch
---

Opening an earlier task in the CLI (`--session-id`, `--continue` or the history picker) no longer shows an approval dialog or a follow-up question from the task's history. Every question the task had already answered was replayed as if it were being asked again, so the CLI could show, for example, "Read src/old.ts, do you want to proceed?" for a file read that happened long ago.
