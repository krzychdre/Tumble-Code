---
"tumble-code": patch
---

Fixed: **Commands run only in a directory of the workspace.** A working directory the model picks for a command must now lie in the workspace, and the `.rooignore` and protected-file checks look at the files the command would really touch from there, so a command that runs elsewhere has to say so in its own text, where you see it.
