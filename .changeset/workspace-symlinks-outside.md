---
"tumble-code": patch
---

Fixed: **A symlink in the workspace that points elsewhere now counts as outside the workspace.** Reading or editing through such a link asks like any other file outside the workspace, and the changed-files panel no longer shows the contents of a file a link points to outside the workspace.
