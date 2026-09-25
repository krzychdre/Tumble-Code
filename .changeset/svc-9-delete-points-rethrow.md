---
"tumble-code": patch
---

Codebase indexing no longer loses track of stale search results when Qdrant refuses to delete them. A failed delete used to be logged and ignored, so the index kept the old code chunks of deleted or changed files forever while the extension believed they were gone; now the failure reaches the file watcher and the scanner, which keep the file marked for another attempt.
