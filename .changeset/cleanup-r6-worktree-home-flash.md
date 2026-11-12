---
"tumble-code": patch
---

Fixed: **Home screen briefly showed worktree tasks for users who disabled them**

The worktree toggle was missing from the initial webview state, so the home screen could show worktree tasks for a moment before the saved setting arrived.
