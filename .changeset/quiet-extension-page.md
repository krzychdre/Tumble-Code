---
"tumble-code": minor
---

Fixed: **The extension page no longer freezes VS Code.** Checkpoints now live in `~/.roo/checkpoints` instead of the extension's data folder, which VS Code walks whenever you open the Tumble Code page or switch its tabs. Checkpoints taken by earlier versions stay where they were; move `<data folder>/tasks/<task id>/checkpoints` to `~/.roo/checkpoints/<task id>` if you want to keep using them.
