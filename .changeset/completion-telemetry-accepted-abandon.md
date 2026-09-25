---
"tumble-code": patch
---

A finished task that you leave with "Start New Task" (or by opening another task, or with /new or /clear in the CLI) is now recorded as a completed task in telemetry. Before, only tasks whose completion was explicitly accepted with a "yes" answer were counted, which the chat and the CLI never send, so completed chat tasks were missing from the "Task Completed" events sent to the cloud.
