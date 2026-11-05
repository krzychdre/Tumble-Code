---
"tumble-code": minor
---

Improved: **"Max concurrent requests" counts every request to the model.** The profile limit (in the CLI `models.<id>.maxConcurrentRequests`) now bounds all requests the model gets at once, from every task, editor tab and subagent in the VS Code window or CLI run, including condensing and memory requests. A request over the limit waits for a free slot instead of overloading a local server.
