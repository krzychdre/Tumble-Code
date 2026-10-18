---
"tumble-code": patch
---

The subagents panel now lists every subagent of a task. Before, each new batch of parallel subagents replaced the earlier ones in the panel, and a task reopened from history showed only its last batch. When a task started subagents several times, each batch has its own header with its start time and how many finished; earlier finished batches start collapsed. Tasks from before this change get their missing subagents back from the task history.
