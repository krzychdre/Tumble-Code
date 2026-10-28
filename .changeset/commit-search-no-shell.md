---
"tumble-code": patch
---

Fixed: **Searching commits after `@` can no longer run a command.** Text typed in the commit search, including quotes, `$(...)` or backticks, is searched for as text, and the search waits until you stop typing instead of running git on every keystroke.
