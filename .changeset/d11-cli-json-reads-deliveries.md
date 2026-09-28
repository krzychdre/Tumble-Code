---
"@tumble-code/cli": patch
---

The JSON output modes (`--output-format json` and `stream-json`) now emit every message the task adds, including a message that arrives together with the next one, which used to be skipped. Resuming a task with `--session-id` no longer emits a stray event from the task's history, and `--exit-on-error` now also stops on a retry that arrives together with another message, but no longer on an old retry in a resumed task's history.
