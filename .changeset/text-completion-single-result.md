---
"tumble-code": patch
---

A task that ends with a plain text answer (no tool call) now shows that answer once, as the "Task Completed" result, instead of the same text twice (once as a message, once as the result). The shortcut that turns such a text-only turn into the completion also no longer steps aside when the only open reminder is "In Progress": with weak models that item is routinely the delivery itself, and the "you did not use a tool" retry only made the model regenerate the same answer through attempt_completion (an extra request, about ten seconds, and the output paid for twice). Reminders still "Pending" keep the retry, so a model narrating mid-task does not complete the task by accident.
