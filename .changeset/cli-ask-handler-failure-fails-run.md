---
"tumble-code": patch
---

Fixed: **CLI: a failed ask handler fails the run instead of hanging it.** When handling a prompt or approval failed, the CLI sat silent forever; the run now ends with the handler's error and exit code 1.
