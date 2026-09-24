---
"tumble-code": patch
---

The cost recorded for Anthropic and MiniMax requests now includes the model's real output tokens. Both providers report a small provisional output count when a response starts and the final count at the end; the cost was computed from the provisional count only, so every response was billed as if it had produced about one output token and the recorded cost (in the chat and in the cloud cost table) was too low.
