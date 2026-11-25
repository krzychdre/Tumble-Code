---
"tumble-code": patch
---

Improved: **Long tasks stay cached.** When a long task fills the context, old tool output is now cleared in one larger step instead of a little more on every turn, so the following requests reuse the model's prompt cache instead of re-reading most of the conversation.
