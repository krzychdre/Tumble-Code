---
"tumble-code": patch
---

Fixed: **A task id can no longer point task files outside the task storage.** A new task started with an id that is no plain name is refused instead of writing its conversation and checkpoint repository wherever the id pointed.
