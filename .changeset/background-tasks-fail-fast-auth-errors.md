---
"tumble-code": patch
---

Background tasks (memory writers and parallel subagents) no longer retry failed API requests forever: they stop at once on 401, 403 or 404, always wait between retries (also with auto-approve off), and give up after 7 attempts; a parallel subagent reports the API error to its parent task.
