# Fix Stack 3 — Remaining Deferred Findings (2026-07-11)

Companion to [`2026-07-11_codebase-review-findings-register.md`](./2026-07-11_codebase-review-findings-register.md)
and [`2026-07-11_deferred-findings-fix-stack-2.md`](./2026-07-11_deferred-findings-fix-stack-2.md).
This batch implements the **final 8 deferred findings** from the register:
TE-4…TE-8, TL-2, AP-8, and CB-8's server-side org-policy half. Stacked linearly on
`fix/memory-ranker-error-logging` (fix-stack-2 tip); build installed builds from the
new tip.

These were deferred from stack 2 because they need small design decisions; those
decisions are made here, per-branch.

## Branches (in stacking order)

### B16 `fix/parser-first-chunk-without-id` — TE-5 [med]

`NativeToolCallParser.processRawChunk` only initializes tracking when a chunk carries
an `id`. A weak model emitting the first chunk with `name`+`arguments` but `id` only
later (or never) loses that chunk's arguments silently → tool call never assembles →
`consecutiveNoToolUseCount` climbs. **Decision:** initialize tracking when ANY of
`id`/`name`/`arguments` is present, using an `index`-based synthetic id
(`synthetic-tool-call-{index}`) when `id` is absent; adopt the real `id` if it arrives
in a later chunk for the same index.

### B17 `fix/orphaned-tool-call-end` — TE-8 [med]

In `TaskStreamProcessor.handleToolCallEvents`, a `tool_call_end` whose
`finalizeStreamingToolCall` returns `null` AND whose id has no tracked
`toolUseIndex` (e.g. a deduped duplicate start) falls through both branches — the
tool call is silently dropped, leaving a `tool_use` with no `tool_result` → API 400
next turn. **Decision:** add the missing `else` branch emitting a synthetic error
tool_result so the protocol invariant (every start gets an end) holds.

### B18 `fix/write-tool-stale-edit-type` — TL-2 [high]

`WriteToFileTool.execute()` reuses `diffViewProvider.editType` set by `handlePartial`
for whatever path it last saw. If partial-json and the final `JSON.parse` disagree on
`path` (documented partial-json behavior on truncated strings), `fileExists` is
computed for the wrong file. **Decision:** record the `relPath` the partial phase
validated alongside `editType`; in `execute()`, when the final path differs, discard
the stale `editType` and re-check existence for the actual path.

### B19 `fix/await-task-completion-leak` — TE-4 [med]

`ClineProvider.awaitTaskCompletion` resolves only on `TaskCompleted`/`TaskAborted`/
signal-abort. A Task disposed (`removeAllListeners()`) before either event leaves the
promise pending forever, leaks the `backgroundTasks` entry, and hangs
`runWithConcurrency`'s `Promise.all`. **Decision:** make `dispose()` emit
`TaskAborted` first if neither terminal event has been emitted (single source of
truth at the Task level), rather than a timeout in every waiter.

### B20 `fix/cancel-task-abort-race` — TE-7 [med]

`ClineProvider.cancelTask` calls `task.abortTask()` un-awaited, then sets
`abandoned = true` while abort is still running; a non-`user_cancelled` abort that
hits the 60s drain blows the 3s `pWaitFor(isStreaming)` ("Failed to abort task").
**Decision:** await `abortTask()` (bounded by the same pWaitFor pattern) so
`abandoned` is set after abort has actually progressed; keep the user-cancel fast
path unchanged.

### B21 `fix/drain-await-settle` — TE-6 [med]

`drainPendingExtraction` (and its B10 mirror `drainPendingDreams`) abort remaining
controllers after the timeout but return immediately — the drain doesn't guarantee
work has stopped when it returns. **Decision:** after aborting, await
`Promise.allSettled` of the remaining in-flight promises with a short grace timeout
(a few seconds), in BOTH drains, keeping them symmetrical.

### B22 `fix/o3-reasoning-extraction` — AP-8 [med]

`openai.ts` O3-family `handleStreamResponse` never calls
`extractReasoningFromDelta`, unlike the main path — reasoning output silently
dropped for O3 models. **Decision:** add the same extraction/yield as the main path.

### B23 `fix/share-org-policy-enforcement` — CB-8 [med]

`share_task` doesn't enforce org policy server-side; a direct
`POST /api/extension/share {visibility:"public"}` bypasses the client-only
`canSharePublicly()` check. The `Literal` narrowing shipped in B5; this adds the org
half. **Decision:** `share_task` loads the task's organization settings and rejects
when `enable_task_sharing` is false (any share) or `allow_public_task_sharing` is
false (public share), with a non-leaking error.

## Discipline

Failing test first, minimal fix, green (targeted vitest/pytest). One branch per
functionality, stacked linearly. Nothing pushed/merged without the user's say-so.
All LLM-facing behavior designed for weak models.
