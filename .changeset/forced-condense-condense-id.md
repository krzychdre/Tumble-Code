---
"tumble-code": patch
---

Rewinding or restoring a checkpoint past a condense that ran after a "context window exceeded" error now also undoes that condense, so the model sees the same restored conversation as the chat.
