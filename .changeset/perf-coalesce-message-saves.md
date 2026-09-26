---
"tumble-code": patch
---

While a task streams, its chat messages are written to disk once it has been quiet for a second (at least every three seconds) instead of after every single message; each write carries the whole conversation, so long tasks wrote hundreds of megabytes. The file is still written at once when the task starts, stops to wait for you, is cancelled, or when VS Code or the CLI closes. The chat view and cloud sync still receive every message immediately.
