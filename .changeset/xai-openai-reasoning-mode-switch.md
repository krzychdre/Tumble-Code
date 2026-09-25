---
"tumble-code": patch
---

Fix xAI (and Anthropic and Bedrock) requests failing with "message.content is not iterable" after a task switched from an OpenAI or Codex mode: the OpenAI encrypted reasoning of earlier turns is now left out for providers that cannot read it, and sent again when the task switches back to OpenAI.
