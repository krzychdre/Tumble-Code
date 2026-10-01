---
"tumble-code": patch
---

Deleting a project mode while no folder is open no longer offers to delete, or deletes, a `.roo/rules-<mode>` folder relative to wherever VS Code was started. All places that read, export, import or delete a mode's rules folder now compute its location the same way.
