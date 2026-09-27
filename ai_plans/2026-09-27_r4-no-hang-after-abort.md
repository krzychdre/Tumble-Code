# R4: no endless wait after an abort

Item R4 of `2026-09-27_simplification-roadmap.md`.

## Problem

1. `TaskApiLoop.finalizeStreamAndProcessResults` waited with
   `pWaitFor(() => userMessageContentReady)`, with no abort term and no timeout. The flag is set when the tools of
   the turn have produced their results. A task aborted while a tool was still running (during its approval ask,
   for example) never sets it, so the loop of the abandoned task polled every 20 ms for the rest of the session.
2. `presentAssistantMessage` threw when the task was already aborted. All ten production call sites fire it
   without awaiting, so the throw could only become an unhandled promise rejection.

## Change

- The wait is `userMessageContentReady || abort`; on abort the method returns `"return_true"`, the same outcome
  `handleEmptyAssistantResponse` uses for an abort, which ends `initiateTaskLoop`.
- `presentAssistantMessage` logs and returns on an aborted task instead of throwing. Nothing awaited the throw.

## Tests

- New `TaskApiLoop.abort-during-tool.spec.ts`: the wait ends with `"return_true"` when the task is aborted, and
  still pushes the tool results when they arrive.
- `presentAssistantMessage-abort.spec.ts`: an already aborted task resolves quietly and asks nothing.
- Both new failing cases fail without the fix. `vitest run core` passes (4373 tests).
