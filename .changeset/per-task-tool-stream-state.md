---
"tumble-code": patch
---

Internal cleanup with no visible change: the streaming state of a tool call (for example the path of a file being written) is now kept on the task that runs it instead of on the shared tool objects, so parallel subagents can never mix up each other's streaming previews.
