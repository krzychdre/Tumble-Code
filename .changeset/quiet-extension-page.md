---
"tumble-code": minor
---

Fixed: **The extension page no longer freezes VS Code.** Checkpoints now live in `~/.roo/checkpoints` instead of the extension's data folder, which VS Code walks whenever you open the Tumble Code page or switch its tabs. Existing checkpoints move there on the next start, and nothing in your task history is lost.
