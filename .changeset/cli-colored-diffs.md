---
"tumble-code": patch
---

File edits in the CLI now show a real coloured diff instead of the raw SEARCH/REPLACE text. Removed lines sit on a red band, added lines on a green band, and the `<<<<<<< SEARCH`, `=======` and `:start_line:` scaffolding is gone from the preview, so all eight preview rows carry actual changes. Edits that report their diff in the `content` field (`write_to_file` and editor-backed edits, which send a unified diff and no `diff` field) used to render no preview at all and now render one too.
