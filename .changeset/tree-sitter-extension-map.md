---
"tumble-code": patch
---

Fix code definitions and code indexing for `.erb`, `.ejs` and `.htm` files, which were never parsed, and stop `.elm` and `.vb` files from failing when their definitions are requested (Elm files are now indexed in plain chunks).
