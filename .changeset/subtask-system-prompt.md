---
"tumble-code": patch
---

Improved: **Subtasks get a prompt written for subtasks.** A task started by another task (an orchestrator's subtask or a parallel subagent) now gets a shorter system prompt that states the delegation rules once, without the memory-writing instructions and without mode switching, so the orchestrator no longer has to repeat those rules in every assignment.
