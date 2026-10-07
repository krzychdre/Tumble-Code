---
"tumble-code": patch
---

apply_diff now accepts an indented `:start_line:` header, drops stray `=======` and `>>>>>>> REPLACE` lines when their meaning is clear, applies a block whose `:start_line:` is far off when its search text matches exactly once in the file, and says plainly when a block has more than one `=======` separator.
