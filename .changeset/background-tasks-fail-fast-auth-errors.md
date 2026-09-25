---
"tumble-code": patch
---

Background tasks (memory writers and parallel subagents) now stop at once when the provider answers 401, 403 or 404 instead of retrying forever; a parallel subagent reports the API error to its parent task.
