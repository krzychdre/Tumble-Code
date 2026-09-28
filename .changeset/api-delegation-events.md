---
"tumble-code": patch
---

Extensions using the public API now receive the taskDelegated, taskDelegationCompleted and taskDelegationResumed events when a task hands work to a subtask and gets the result back; before, these events were never delivered.
