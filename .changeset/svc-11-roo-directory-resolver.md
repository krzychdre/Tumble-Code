---
"tumble-code": patch
---

A slash command in `~/.roo/commands` now overrides a built-in command of the same name in the slash menu too, not only when it runs. With subfolder rules on, the workspace is scanned for nested `.roo` folders once instead of three times per request, the slash menu no longer re-reads every command file on each keystroke, and nested `.roo` folders are no longer dropped silently in workspaces with more than 500 files inside `.roo` folders.
