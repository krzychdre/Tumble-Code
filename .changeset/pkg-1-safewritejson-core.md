---
"tumble-code": patch
---

Internal: the atomic JSON writer (`safeWriteJson`) now lives in the shared core package instead of the extension folder, and the CLI bundles its file-locking dependencies instead of installing them separately. JSON files are written exactly as before.
