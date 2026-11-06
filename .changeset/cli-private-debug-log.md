---
"tumble-code": patch
---

Fixed: **CLI: private debug log and exports.** `~/.roo/cli-debug.log` and the files `/export` writes are now readable by you only, and a debug log over 10 MB is moved to `cli-debug.log.1` when the next `--debug` run starts.
