---
"tumble-code": patch
---

Tasks started before the previous fix could keep showing codes such as `ł` instead of Polish letters in Task Completed, because the model kept copying its own earlier escaped answers from the task history. Those earlier answers are now sent to the model with real letters (the saved history itself is not changed), so a resumed task stops repeating the pattern.
