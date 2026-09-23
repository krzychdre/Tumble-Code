---
"tumble-code": patch
---

The CLI transcript now puts the conversation first. Bash and MCP rows no longer print a preview of their output: a collapsed row is the command (or the MCP server and tool) plus one line counting the output, `⎿ … +27 lines (ctrl+o)`, and ctrl+o still prints all of it. Tool results and the `∴ Thinking` rows use a darker grey, so the eye skips them; before, they were not dimmed at all in GNOME Terminal and other VTE-based terminals, which ignore the dim attribute on RGB colours. Your own messages sit on a slate-blue band with an orange `❯` and bold text, so every turn stands out. The interactive CLI starts on a clean screen; the shell history above stays in the scrollback.
