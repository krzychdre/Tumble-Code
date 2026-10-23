---
"tumble-code": patch
---

CLI internals: the TUI's submit hook reads a slash command and its argument once and runs it from a table of command handlers; the null checks for host functions that always exist are gone, and Y and N on an approval share one handler. No user-visible change.
