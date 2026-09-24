---
"tumble-code": patch
---

File edits streamed by parallel subagents no longer disturb the main task's edits: the live preview of a file being written shows up again while subagents are also writing, a write to an existing file is no longer labelled as a new file after another task finished its own write, and a failed edit no longer leaves its row spinning when another task edited a file at the same time.
