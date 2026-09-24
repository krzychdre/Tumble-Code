---
"tumble-code": patch
---

The checkpoint saved before `new_task` and `generate_image` can now start as soon as the tool call begins streaming, as it already did for file edits, instead of always waiting until the tool is about to run.
