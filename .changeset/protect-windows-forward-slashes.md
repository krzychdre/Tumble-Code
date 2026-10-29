---
"tumble-code": patch
---

Fixed: **Protected settings stay protected on Windows when code writes the path with `/`.** An auto-approved `node -e` or `python -c` command that names VS Code's settings folder with forward slashes now asks first, as it already did with backslashes.
