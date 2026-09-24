# Zoo #1323 port: interrupted tool calls are errors in the resumed history

**Status:** ported, one commit on the zoo port branch
**Upstream:** Zoo-Code #1323 (commit c28a1ffe7), by Eason Liang
**Touched:** `src/core/task/TaskResumption.ts`, `src/core/task/__tests__/TaskResumption.interrupted-tool-calls.spec.ts`

## Symptom

When a task is resumed after an interruption that left tool calls unanswered, the resume writes
synthetic `tool_result` blocks ("Task was interrupted before this tool call could be completed.")
so the API conversation stays valid. They had no `is_error`, so the persisted history reads as if
the interrupted calls (for example `attempt_completion`) succeeded, while the task list records the
task as interrupted. Anything that infers the outcome from `api_conversation_history.json` (cloud
metrics, `search_task_history`, the model itself on the next turn) is misled.

## Root cause in our code

Our resume logic lives in `TaskResumption.ts`, not `Task.ts`. Two synthesis sites, neither set
`is_error`:

- `handleAssistantLastMessage` (`TaskResumption.ts:349`): history ends with an assistant turn whose
  tool calls were never answered.
- `handleUserLastMessage` (`TaskResumption.ts:397`): history ends with a user turn that answered only
  some of the previous assistant turn's tool calls.

## Fix

Both sites now add `is_error: true` to the synthetic results. Real, already persisted results are
left exactly as they were.

## Tests

New `TaskResumption.interrupted-tool-calls.spec.ts` drives `resumeTaskFromHistory` with a stub
access object (same pattern as `TaskResumption.snapshot.spec.ts`) and checks the user content the
resumed request starts with. Before the fix both cases failed on the missing `is_error: true`;
after it both pass. The existing `TaskResumption.snapshot`, `Task.persistence`, `Task.spec`,
`task-tool-history` and `TaskLifecycle.lazy-access` suites stay green.

## Not ported

- Zoo's tests were written against `Task.persistence.spec.ts` with a full `Task`; ours target the
  split `TaskResumption` class directly, which is simpler and exercises the same code.
- Zoo's issue links in comments.
