---
"tumble-code": patch
---

MCP servers: a failed connect or restart no longer leaves the hub marked as "connecting", which made every following API request wait up to 10 seconds. Editing the MCP settings file no longer restarts servers whose configuration did not change, deleting one server no longer restarts the others, other servers keep their file watchers, and a server gets one watcher per path instead of two (one file change used to restart it twice).
