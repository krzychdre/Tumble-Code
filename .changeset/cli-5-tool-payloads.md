---
"tumble-code": patch
---

CLI tool rows now show what the VS Code chat rows show for the same tool call, because both read the tool payload through one shared reader. Web searches, web fetches, slash commands, skills, artifact reads, task history searches, plan reviews and image generations get a readable title with their query, URL, name or byte range instead of the raw internal tool name. A new subtask or a finished subtask no longer renders as "Switch Mode", a mode switch shows its reason, file and codebase searches show where they looked, the older edit tool names render as edits, and an applied diff shows the unified diff with real line numbers. The approval prompt for a web search or a slash command also shows the queries or the command name.
