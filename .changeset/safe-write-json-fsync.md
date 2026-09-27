---
"tumble-code": patch
---

Make settings and task history writes durable across a power loss. `safeWriteJson` now flushes the temporary file to disk (`fsync`) before renaming it over the target, so the target can no longer end up as an empty file when the machine loses power right after a save.
