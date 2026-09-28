---
"@tumble-code/cli": patch
---

Internal cleanup of how the CLI reads the extension's messages: the separate state store is gone, and the agent state and the task's messages now come from the same place that decides what is new in each message. The terminal, print and JSON output are unchanged.
