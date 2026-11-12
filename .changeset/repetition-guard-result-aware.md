---
"tumble-code": patch
---

Fixed: **Watching a long job is no longer stopped as a loop.** A command repeated to check on a running job (for example `sleep 300; tail -1 build.log`) used to be stopped at the fourth call as a suspected loop. It now runs as long as each call returns something new; a call that keeps returning the same result is still stopped.
