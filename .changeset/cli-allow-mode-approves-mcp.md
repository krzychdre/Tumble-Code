---
"tumble-code": patch
---

The CLI no longer hangs when the model calls an MCP tool in the default `allow` permission mode. Automatic approval covered only the MCP tools listed under `alwaysAllow` in the server's config; any other tool waited for an approval that the CLI never asks for in this mode, so the task stopped with the spinner still running. `allow` now approves every MCP tool, as documented. Follow-up questions and the plan review gate still ask as before.
