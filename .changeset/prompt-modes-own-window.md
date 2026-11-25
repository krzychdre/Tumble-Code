---
"tumble-code": patch
---

Fixed: **The modes list in the prompt no longer flips while another VS Code window is open.** A second window, for example a Remote-SSH one with different custom modes, could swap the list in this window's prompt every few seconds, so the model had to re-read the whole conversation instead of using its cache.
