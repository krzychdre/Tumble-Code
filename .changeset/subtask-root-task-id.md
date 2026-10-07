---
"tumble-code": patch
---

Subtasks nested more than one level deep now record the top task of the chain as their root task. Before, every level below the first child recorded its parent as the root, so the root id saved in the task history and in the LLM exchange dataset was wrong for deeper subtasks. Already saved tasks keep their old value.
