---
"tumble-code": patch
---

Fixed: **Self-hosted cloud: long streamed answers no longer slow the server down.** Saving a message while it streams now costs the same for every chunk however long the message gets, and the server keeps only a bounded number of unsaved chunks in memory.
