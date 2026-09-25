---
"tumble-code": patch
---

Memory now learns from finished chats: when a task has completed and you click "Start New Task" (or open or start another task), the background memory extraction and consolidation run for it, as intended. Before, they never ran after a normally completed task in the VS Code chat, and leaving a task no longer waits for memory writers that are still running.
