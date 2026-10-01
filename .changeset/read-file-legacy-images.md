---
"tumble-code": patch
---

When a model asks to read files with the older multi-file `read_file` format, images now reach the model the same way as with the current format; before, the model was only told that the image had been processed. Requested line ranges are now capped at 2000 lines each (with a note on how to read on), images count against the total image size limit, and PDF and DOCX files are read as text in that format too.
