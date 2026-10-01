---
"tumble-code": patch
---

`write_to_file` and `apply_diff` now use the same approval and save step as the other file-editing tools. With auto-approved writes, an `apply_diff` on a file outside the workspace now asks first unless writes outside the workspace are allowed, as every other edit tool already did. `write_to_file` no longer saves the line numbers copied from `read_file` output when files are written without the diff editor, reports an unchanged file without asking, and shows its diff 300 ms sooner.
