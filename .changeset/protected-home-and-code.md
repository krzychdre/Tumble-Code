---
"tumble-code": patch
---

Fixed: **Shell commands can no longer rewrite your global MCP settings without asking.** A command that writes a protected file through `~`, `$HOME`, a path only known when it runs, or inline code such as `python3 -c` that names a protected location now asks first, even when the command itself is auto-approved.
