---
"tumble-code": patch
---

The `@` file search in the chat no longer walks the whole workspace with ripgrep on every query. The file list is kept per workspace and refreshed when files are created, deleted or renamed, when an ignore file (`.gitignore`, `.ignore`, `.rgignore`) changes, or after 30 seconds. Results after the first query of a word come back noticeably faster, especially in large workspaces.
