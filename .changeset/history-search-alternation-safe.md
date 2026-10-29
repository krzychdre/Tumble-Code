---
"tumble-code": patch
---

Fixed: **Searching a saved tool output or the task history can no longer freeze the extension with a choice inside a repeat.** Patterns such as `(a|a)*b` or `(a{1,5})+b`, which could take seconds to minutes on one line, are searched for as plain text, like the nested repeats before them.
