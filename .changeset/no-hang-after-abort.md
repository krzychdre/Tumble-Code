---
"tumble-code": patch
---

Stop an aborted task's request loop from polling forever. When a task was cancelled while a tool was still running (for example during its approval prompt), the loop kept waiting for the tool results every 20 ms for the rest of the session; it now ends as soon as the task is aborted. Presenting a tool call on an already aborted task no longer produces an unhandled promise rejection.
