---
"tumble-code": patch
---

Improved: **Saving a memory note no longer slows down running tasks.** Each task reads the memory index once, when it starts, so a note saved by one task (or by a subtask) no longer makes the other running tasks re-read their whole conversation.
