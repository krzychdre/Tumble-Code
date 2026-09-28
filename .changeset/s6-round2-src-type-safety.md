---
"tumble-code": patch
---

Internal type-safety cleanup with no change in behaviour: most loose `any` casts outside the task loop are replaced by real types, and background failures that used to be swallowed without a trace (artifact cleanup, history watchers, background task aborts, superseded tool prompts) are now written to the debug log.
