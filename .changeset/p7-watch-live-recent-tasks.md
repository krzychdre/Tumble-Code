---
"tumble-code": patch
---

TaskHistoryStore no longer opens one `fs.watch` per task folder: only the live task and tasks modified within the last ten minutes keep a watcher, and the existing five-minute reconcile covers everything else. Thousands of saved tasks no longer exhaust the inotify watch limit on startup.
