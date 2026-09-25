---
"tumble-code": patch
---

Internal cleanup with no change in behavior: built-in tools and MCP server tools now receive their approval, result and error callbacks from one shared factory instead of two hand-copied versions, so a future fix to how tool results, approval feedback or tool errors are reported reaches both kinds of tools at once.
