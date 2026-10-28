---
"tumble-code": patch
---

Fixed: **Self-hosted cloud task duration counts only the model's time.** A task's duration on the task list and the usage metrics page is now the sum of its model requests, each from sending it to the end of the answer, so waiting for you, approvals, running commands and continuing a task days later no longer count. A task with subtasks shows the duration of the whole run. Tasks recorded before this version show no duration.
