---
"tumble-code": patch
---

Fixed: **CLI: settings, history and secrets files are readable by you only.** The CLI now creates `~/.roo` for its owner only and writes `cli-settings.json`, `cli-history.json` and its secrets file with owner-only permissions from the moment they are written, also when an older version left them readable by other users.
