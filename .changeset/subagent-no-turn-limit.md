---
"tumble-code": patch
---

Parallel subagents are no longer cut off after 50 turns: a subagent now works until it finishes. It is stopped only when it is stuck, that is when it keeps failing tool calls or keeps repeating the same call after a hint to change course, and when its model keeps returning empty answers. A subagent that stops without finishing now says why (for example "Stopped as stuck: it made 6 mistakes in a row") instead of "subtask aborted before completion", and the parent task gets its last message and where its partial work is.
