---
"tumble-code": patch
---

The model is now told to use subagents often: any self-contained job that can run beside other work (code questions, research, test runs, edits in their own files) goes to a subagent, one review is still never split into chunks. A run_parallel_tasks call without a concurrency value now uses the "Max parallel subagents" setting instead of at most 3.
