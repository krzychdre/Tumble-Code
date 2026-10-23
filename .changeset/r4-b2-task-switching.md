---
"tumble-code": patch
---

Leaving the current task (new task, clear, open from history, reattach) goes through one provider method, and the replay of a message edit after a checkpoint restore lives in `PendingEditOperations`. No user-visible change.
