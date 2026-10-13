---
"tumble-code": patch
---

Polish and other non-English letters no longer show up as `\u0142`-style codes in the Task Completed block, in todo lists, in subtask messages or in files the model writes. The system prompt asked models to write such letters as JSON escapes; models often escaped the backslash as well, so the code itself reached the screen and the disk. The rule is gone.
