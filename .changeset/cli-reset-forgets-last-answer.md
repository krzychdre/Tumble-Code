---
"tumble-code": patch
---

After `/new`, `/clear` or switching to another task, the CLI no longer hides the first answer of the new task when it happens to be word for word the same as the last answer of the previous task (for example asking "Say hi" twice). The CLI used to keep a note of the last answer across the reset and dropped the new one as a repeat.
