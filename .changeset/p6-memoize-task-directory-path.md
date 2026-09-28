---
"tumble-code": patch
---

Performance: `getStorageBasePath` (the storage-root resolution behind `getTaskDirectoryPath` and every task-history read/save) no longer re-runs `mkdir` + `access` on the custom storage path on every call. Successful resolutions are memoized per `(globalStoragePath, customStoragePath)` pair; the config value is re-read on every call, so changing the setting resolves fresh, and fs failures stay uncached (retry + fallback behavior unchanged). The per-task directory mkdir is deliberately not cached because task directories are deleted at runtime.
