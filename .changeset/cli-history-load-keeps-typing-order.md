---
"@tumble-code/cli": patch
---

Typing right after the CLI starts no longer scrambles the first characters. The prompt was re-created when the input history finished loading from disk, and on a slow disk that happened mid-typing, so the cursor lost its place ("draft" came out as "raftd").
