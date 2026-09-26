---
"roo-code": patch
---

Fix file links containing Windows absolute paths (`C:/...`, `C:\...`, UNC `\\server\share`). Markdown links with a drive letter rendered with an empty href (dead link), and tool-result/checkpoint/search-result rows prefixed absolute paths with `./`, which resolved them against the workspace instead of opening the absolute path. Windows drive/UNC paths now pass through to the editor untouched; POSIX and relative paths keep their existing behavior.
