---
"tumble-code": patch
---

Parallel subagents started by a task show up in the task history as its subtasks, with their own mode, cost and tokens. The cost of the whole task in the history and in the task header now includes what its parallel subagents spent. Before, their cost was not counted anywhere outside the cloud.

Deleting a task deletes its parallel subagents too, and stops the ones still working.

Clicking a subagent that is still working opens the task that started it, where it is listed in the subagents panel. A finished subagent opens read-only: you can read what it did, but it cannot be resumed, because it worked in its own copy of the repository that may no longer exist.
