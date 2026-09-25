---
"tumble-code": patch
---

Codebase indexing no longer leaves file watchers behind: after Stop and Start the index status keeps updating for file changes, an error recovery no longer leaves a second watcher indexing, and removing a workspace folder stops its indexer.
