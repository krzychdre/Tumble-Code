---
"tumble-code": patch
---

A subtask can no longer start a new subtask in its own mode, and subtasks can no longer nest more than 5 levels below the task you started. A model that could not do something kept handing the same job to a copy of itself in the same mode and on the same model; one such chain grew to about 90 nested subtasks before it was stopped by hand. The model now gets an error telling it to do the work itself or finish and explain what could not be done.
