---
"tumble-code": patch
---

Searching files with an invalid regular expression now tells the model what is wrong with the pattern instead of reporting "No results found", and every ripgrep search (file search, @-mention search, file listing) now shares one runner with a time limit, so a stuck search can no longer hang the task.
