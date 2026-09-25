---
"tumble-code": patch
---

When the agent already saved a memory itself during a task, the background memory extraction at the end of that task is now skipped as intended. The check that looked for those saves read a field chat messages never have, so it never found one and the extraction always ran, spending an extra model call and risking duplicate memories.
