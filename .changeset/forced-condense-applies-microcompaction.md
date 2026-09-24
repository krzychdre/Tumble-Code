---
"tumble-code": patch
---

When the model provider rejects a request because the conversation no longer fits the context window, the retry now actually sends a smaller request. Previously, if clearing old tool output was enough to fit, that decision was thrown away and the retry resent the exact request that had just been rejected, so all three retries failed the same way.
