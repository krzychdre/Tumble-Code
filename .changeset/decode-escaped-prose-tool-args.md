---
"tumble-code": patch
---

Polish and other non-English letters no longer show up as `\u0142`-style codes in the Task Completed block, in questions, in todo lists or in subtask messages when a model writes them that way in its tool call. Removing the old escape rule from the prompt (previous release) was not enough: in a task that already held such calls, the model kept copying them. The codes are now turned back into letters in these prose arguments, outside code examples. File content and commands stay exactly as the model wrote them.
