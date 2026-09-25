---
"tumble-code": patch
---

The file edit tools (edit, search_replace, edit_file, apply_patch) now share one approval, diff view and save step. Background memory tasks that edit with edit, search_replace or apply_patch no longer open a diff editor tab, and edit accepts an absolute path inside the workspace the same way search_replace does.
