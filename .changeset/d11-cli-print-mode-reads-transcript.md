---
"@tumble-code/cli": patch
---

Print mode now reads the agent's messages the same way the interactive CLI does. An answer that the model repeats in its completion result is printed once instead of twice, a command's output is printed as one block instead of repeating its first chunk, a message that arrives together with the next one is no longer skipped, and resuming a task with `--session-id` no longer prints a stray message from the task's history.
