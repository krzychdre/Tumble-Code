---
"tumble-code": patch
---

Parallel subagents run in the background. `run_parallel_tasks` returns as soon as the first subagent finishes, and the new `wait_for_subagents` tool collects the next results one by one, so the task can start a follow-up subagent the moment a result allows it (one subtask per call is now accepted). A message you send while the subagents work is answered right away, and they keep running. The task cannot finish before every subagent has reported, its environment details list the subagents still running, and the "Max parallel subagents" setting now caps all subagents running at once, not each `run_parallel_tasks` call on its own.
