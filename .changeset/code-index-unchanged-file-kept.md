---
"tumble-code": patch
---

Codebase search no longer loses a file from the index when the file is saved or rewritten without any real change (for example by a formatter, a tool writing the same text, or a git checkout). The file watcher used to delete the file's search entries first and only then notice that the content had not changed, so the file stayed missing from search results until its content actually changed. Old entries are now removed only when the file is really re-indexed, and they are kept when re-indexing fails.
