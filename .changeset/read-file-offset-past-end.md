---
"tumble-code": patch
---

When the model asks `read_file` for lines starting after the end of a file, the result now says the offset is past the end and how many lines the file has. Before, it said the file was empty, which made the model treat a long file as an empty one.
