---
"tumble-code": patch
---

Fixed: **Files in `.rooignore` can no longer be read through a slightly different command.** Commands that read or copy files are checked however the path is written: quoted, absolute, built from `$(pwd)`, after `cd`, inside `sh -c`, `sudo` or `$(...)`, and with more readers such as `cp` and `base64`.
