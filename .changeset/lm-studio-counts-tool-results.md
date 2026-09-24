---
"tumble-code": patch
---

LM Studio and OpenAI-compatible servers that do not report usage now have their context size estimated including tool results (such as file contents from read_file) and tool call arguments, so auto-condense triggers on time instead of far too late.
