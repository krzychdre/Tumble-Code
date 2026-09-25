---
"tumble-code": patch
---

A workspace folder added to an open multi-root workspace now starts code indexing on its own, the same way the folders that were open when the extension started do (if indexing is enabled and configured). Before, such a folder stayed unindexed and codebase_search was not offered for tasks in it until the index settings were saved or indexing was started by hand. A folder removed again right away no longer leaves a file watcher running.
