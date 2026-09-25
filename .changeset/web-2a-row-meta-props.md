---
"tumble-code": patch
---

Chat rows no longer search the whole task history each time they draw: the end time of a block, the previous todo list and the subtask link now come from one pass over the history in the chat view, which keeps long tasks responsive while an answer streams in.
