# Fix Stack 2 — Deferred Findings Batch (2026-07-11)

Companion to [`2026-07-11_codebase-review-findings-register.md`](./2026-07-11_codebase-review-findings-register.md).
This batch implements the 19 deferred findings assessed as **immediately required** for
safety, low cognitive complexity, and efficiency of the day-to-day tool. Stacked
linearly on `fix/cloud-share-authz` (previous stack tip); build installed builds from
the new tip.

## Assessment criteria

- **Safety**: security/authorization, data corruption, crash paths (ext-host unhandled rejections).
- **Correctness for the fork's primary use case**: weak local OpenAI-compatible models.
- **Efficiency**: leaks, unbounded growth, retry storms.
- **Maintainability**: eliminate shared mutable static state, dead code.

**Deferred again (not in this batch):** TE-4…TE-8 (narrow task-engine races needing
lifecycle design decisions), TL-2 (needs partial-json path-mismatch design), AP-8 (O3
reasoning — not the fork's use case), CB-8 org plumbing (needs org-context in
`share_task`).

## Branches (in stacking order)

### B6 `fix/parser-per-task-state` — TL-1 [high]

`NativeToolCallParser`'s two static Maps (`streamingToolCalls`, `rawChunkTracker`) are
process-global; `run_parallel_tasks` at `maxConcurrency>=2` deterministically corrupts
tool-call assembly (`resetStreamingState` of task B wipes task A's mid-stream state).

**Design** (refined from the register — the register's "thread the instance through
providers" is unnecessary):

1. Convert the Maps + stateful methods (`processRawChunk`, `processFinishReason`,
   `finalizeRawChunks`, `clearRawChunkState`, `startStreamingToolCall`,
   `clearAllStreamingToolCalls`, `processStreamingChunk`, `finalizeStreamingToolCall`)
   to **instance** members. Pure helpers stay static.
2. `TaskStreamProcessor` owns `private readonly toolCallParser = new NativeToolCallParser()`
   — per-task isolation, `resetStreamingState` clears only its own parser.
3. New `ApiStreamFinishReasonChunk { type: "finish_reason"; finishReason: string }` in
   `api/transform/stream.ts`. Providers that called the parser statically
   (`lm-studio.ts`, `qwen-code.ts`, `openrouter.ts`) now just
   `yield { type: "finish_reason", finishReason }`; `TaskStreamProcessor.processChunk`
   handles the case by calling its own parser's `processFinishReason` and routing the
   events through the same path as `tool_call_partial` events.

This removes the provider→parser layering violation and is the base for B7.

### B7 `fix/finish-reason-finalization` — AP-2 + AP-6 [high]

`base-openai-compatible-provider.ts` only finalizes on `finish_reason==="tool_calls"`;
`deepseek.ts` has no finish-reason handling. Local servers return `"stop"`/`null` after
tool_calls deltas → truncated JSON args executed. **Fix:** both yield the new
`finish_reason` chunk (from B6) for every non-null finish reason; central finalization
flushes all started calls regardless of reason.

### B8 `fix/usage-fallback-condense` — AP-4 + AP-7 + AP-5 [high/med]

- AP-4: `openai-compatible.ts` yields no usage chunk when the server omits usage →
  `tokensIn/Out: 0` forever. Fix: local `countTokens` fallback when usage absent/zero.
- AP-7: `handleContextManagement` guards `if (contextTokens)` → zero tokens = condense
  never triggers → unbounded context growth. Fix: fall back to counting history tokens
  when tracked usage is 0 but history is non-empty.
- AP-5: `nextChunkWithAbort` adds an abort listener per chunk, never removes →
  thousands of listeners per generation. Fix: `{ once: true }` + `removeEventListener`
  in `finally`.

### B9 `fix/memory-coordinator-invalidation` — MEM-1 [high]

`Task.updateApiConfiguration` rebuilds `this.api` but `_memoryCoordinator` caches the
old handler → recall silently dead after profile switch (violates the mode-switching
design constraint). Fix: invalidate `_memoryCoordinator` in `updateApiConfiguration`.

### B10 `fix/autodream-lifecycle` — MEM-2 + MEM-3 [high]

- MEM-2: in-flight autoDream (headless Task, up to 10 turns) is untracked — orphaned on
  shutdown, dead-PID lock, partial writes. Fix: `inFlightDreams` registry +
  `drainPendingDreams(timeoutMs)` mirroring extraction; call in `abortTask`.
- MEM-3: double-fired `triggerMemoryBackgroundWriters` → both dreams pass the same-PID
  lock check → two concurrent consolidations, last-writer-wins corruption. Fix:
  module-level in-flight guard preventing re-entry.

### B11 `fix/memory-hygiene` — MEM-4 + MEM-6 + MEM-7 [med/low]

- MEM-4: `makeSideQuery` leaves the losing `completion` promise uncaught → potential
  ext-host crash via `unhandledRejection`. Fix: `completion.catch(() => {})` before race.
- MEM-6: extraction cursor set to live `messages.length` after a multi-second sub-task
  → messages appended mid-run skipped forever. Fix: snapshot length at start.
- MEM-7: dead `void quoteProblematicValue(...)` in `frontmatter.ts`. Remove.

### B12 `fix/write-tool-partial-hardening` — TL-6 + TL-4 [med, security]

- TL-6: `WriteToFileTool.handlePartial` opens the diff editor before
  `rooIgnoreController.validateAccess` / outside-workspace checks → a streamed
  `../../../etc/passwd` path discloses file content into the diff view. Fix: validate
  before `open()`.
- TL-4: `BaseTool` partial-error path never calls `diffViewProvider.reset()` → stuck
  open editor. Fix: reset in the partial catch.

### B13 `fix/cloud-auth-expiry` — CB-3 + CB-4 [high/med]

- CB-3: `StaticTokenAuthService` hardcodes `isAuthenticated() === true`, never checks
  JWT `exp` → after ~1h every cloud call 401s silently forever. Fix: parse `exp`,
  report `inactive-session` when past, timer to emit the transition.
- CB-4: `WebAuthService.refreshSession` calls async `clearCredentials()` un-awaited →
  unhandled rejection. Fix: `await`.

### B14 `fix/cloud-client-resilience` — CB-5 + CB-6 + CB-7 [med]

- CB-5: settings/telemetry `fetch` without timeout → hung backend freezes settings
  refresh until restart. Fix: `AbortSignal.timeout(30000)` (match `CloudAPI.ts`).
- CB-6: `RetryQueue` default `maxRetries: 0` = infinite retries, persisted across
  restarts. Fix: finite default (5).
- CB-7: `web.py` `_num` counts booleans (Python `bool ⊂ int`) → dashboard/list totals
  diverge. Fix: exclude bools, matching `metrics_service.py`.

### B15 `fix/memory-ranker-error-logging` — MEM-5 companion [high confidence]

Added post-batch: `selectRelevantMemories` (`relevance.ts`) swallowed all non-abort
ranker errors with no logging (the most common weak-model failure mode: error /
timeout / unparseable), making broken recall undebuggable. The `catch` also had dead
identical branches. Fix: `logger.error` on the non-abort branch, matching the
`[memory]` logging convention.

## Discipline

Failing test first, minimal fix, green (targeted vitest/pytest). One branch per
functionality, stacked linearly. Nothing pushed/merged without the user's say-so.
All LLM-facing behavior designed for weak models.
