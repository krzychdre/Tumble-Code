---
"tumble-code": patch
---

Improved: **CLI: installer warns when the installed binary fails to start**

The post-install verification previously ignored the binary's exit status; a failed start is now reported instead of silently printing success.
