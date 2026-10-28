---
"tumble-code": patch
---

Fixed: **Task sync uploads only images inside the workspace.** An image a chat message points to is sent to Tumble Code Cloud only when the file really lies in the task's workspace, so a path outside it, or a link in the repository leading out of it, no longer uploads your other files.
