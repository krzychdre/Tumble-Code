---
"tumble-code": patch
---

Fixed: **`.rooignore` holds up better against shell commands.** Reads through `dd if=`, `git show REV:path`, `git cat-file` and globs such as `cat sec*/key.txt` are blocked like other reads, and commands whose reads cannot be checked (a recursive `grep -r`, `tar`, `cp -r` or `find -exec cat` over a folder holding ignored files, inline `python3 -c` code, a path from a variable) now ask for your approval instead of running automatically.
