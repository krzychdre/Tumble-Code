---
"tumble-code": minor
---

New: **Request budget for a custom mode.** Set `maxRequests` on a mode in `.roomodes` or the global modes file and a task in that mode is told to finish once it has made that many model requests for one assignment, then stopped two requests later. The count starts again when the task switches mode and with every message you send, so the same mode can be used again in one conversation. A parallel subagent stopped this way hands its last message back as a partial report.
