---
"tumble-code": patch
---

The CLI no longer exits right away when `--oneshot` is combined with opening a task that had already finished (for example `--session-id` of a completed task, or picking one from the history). Opening such a task is now treated as waiting for your next message, and `--oneshot` exits when that continued task completes.
