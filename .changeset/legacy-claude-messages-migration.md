---
"tumble-code": patch
---

Very old tasks saved by Cline (with a `claude_messages.json` file) no longer lose their conversation when they are opened. The history is now moved to the current file format before the old file is removed; previously the old file was deleted after the first read without writing the new one, so resuming such a task or searching its history left it empty.
