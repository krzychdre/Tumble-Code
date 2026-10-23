---
"tumble-code": patch
---

The subagent slot pool now enforces the per-call `maxConcurrency` of run_parallel_tasks next to the global and per-profile caps, so a subtask waiting for a busy profile no longer keeps a later subtask on another profile from starting.
