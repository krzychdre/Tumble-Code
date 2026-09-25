---
"tumble-code": patch
---

A file written by write_to_file now always lands at the path the model asked for. When the model sent the file content before the path and the path contained an escaped character, the diff view could open for a cut-off prefix of the path (for example `a/b` instead of `a/b.ts`); the file was then created under that shorter name while the approval card showed the full one. The early diff view is now closed and undone as soon as the real path is known.
