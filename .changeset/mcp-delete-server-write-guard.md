---
"tumble-code": patch
---

Deleting an MCP server no longer makes the extension re-read the settings file and re-check every server a moment later: the delete now counts as the extension's own edit, like every other settings change it writes.
