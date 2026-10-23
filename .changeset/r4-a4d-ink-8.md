---
"tumble-code": patch
---

CLI: the terminal UI runs on ink 8. The live area under the transcript is capped with ink's own `maxHeight`, and the CLI no longer rewrites ink's cursor moves on the way to the terminal, because ink 8 renders growing frames at the bottom of the window correctly.
