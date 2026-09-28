---
"tumble-code": patch
---

D10 refactor: renamed `TaskHistory` to `TaskMessageLog` (one task's API + UI message persistence) so it is no longer confused with `TaskHistoryStore` (the task list) and `TaskHistoryGateway`, and moved the `searchTaskHistory` helper from `core/task/` to `core/tools/helpers/` where the tool that uses it lives. No behavior change; the `search_task_history` tool name and its say-payload format are unchanged.
