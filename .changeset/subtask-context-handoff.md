---
"tumble-code": patch
---

Improved: **Subtasks hand their work over instead of running out of context.** A subtask or subagent whose context reaches 65% of the model's window is told to finish its step and report, and at 85% it returns to its parent with its open TODO items, so a fresh subtask continues the work. Tasks you start yourself still use the whole window.
