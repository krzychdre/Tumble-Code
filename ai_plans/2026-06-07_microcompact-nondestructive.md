# Non-destructive, cache-stable microcompaction (stacked follow-up #3)

Date: 2026-06-07
Branch: `feat/microcompact-nondestructive` (stacked on `feat/condense-circuit-breaker`, off `main`)

## Motivation / evidence

The third deferred mechanism from the gap analysis
(`ai_plans/2026-06-07_context-microcompaction-layer.md`): **cache-stable content
replacement**. Branch 1 ported tool-result microcompaction but in its
**destructive** form — it rewrites `tool_result.content` in the stored
`apiConversationHistory` and persists that via `overwriteApiConversationHistory`.

The leaked Claude Code source has **two** microcompact paths and is explicit
about the distinction (verified by direct read of
`services/compact/microCompact.ts`):

- `cachedMicrocompactPath` (line ~302): _"Takes precedence over regular
  microcompact (**no disk persistence**)"_ — the cache-stable, non-destructive
  path. It does not rewrite the stored transcript; clearing is carried as
  transient pinned cache-edits and applied per request.
- time-based (line ~409): _"Unlike cached MC, this **mutates message content
  directly**. The cache is cold..."_ — the destructive path, used only when the
  cache is already cold. **This is what branch 1 ported.**

Branch 1's destructive form has two real costs (documented in its own plan):

1. **Rewind fidelity loss** — a rewind to before an old cleared result shows the
   placeholder, not the original output.
2. **Stored-transcript rewrite** — the persisted history is mutated, churning the
   on-disk transcript every time microcompaction fires.

### The decisive correctness test: mode switching

A single task can switch modes mid-run, and modes can carry different API
profiles → different models → **different context windows**. Any reduction baked
into persisted history (or destroyed outright) under one model's budget leaks
into a later request under a different model:

- Destructive (branch 1): content cleared under a 200k model is **gone** even
  after switching to a 1M-context model that could have used it. Unrecoverable.
- A persisted tag would keep stripping content after switching to a wider-window
  model that no longer needs it, unless re-evaluated on every switch.

Only a **transient, recomputed-each-request** decision derived from _pristine_
history against the _current_ model self-corrects across a switch. See
`memory/feedback_design_for_mode_switching.md`.

## Decision (Design A — transient recompute, chosen)

Convert microcompaction to the non-destructive / cache-stable model:

- **Never mutate or persist** cleared tool-result content. The stored
  `apiConversationHistory` stays pristine.
- `manageContext` (which already has the token budget) **selects** which
  compactable `tool_use_id`s to clear — keeping the last N raw — and returns
  them; it does **not** rewrite their content. `manageContextIfNeeded` stashes
  that id set on the Task as **transient** state (`microcompactedToolUseIds`),
  recomputed every request that runs context management.
- The send-time chokepoint `ApiRequestBuilder.buildCleanConversationHistory`
  (both send paths delegate to this single impl) replaces the content of those
  ids' `tool_result` blocks with the placeholder **on the outgoing copy only**.
- `condense` and `truncate` switch to operating on **pristine** messages (no
  longer on the microcompacted copy), so branch 2's kept raw tail is pristine and
  the send-time strip is the sole place clearing happens.

Because the id set is recomputed each request from pristine history against the
current model, switching to a wider-context mode simply yields an empty set (no
strip, full fidelity) and switching to a narrower one clears more — automatically.

### Rejected alternatives

- **Persisted ApiMessage tag** (like `condenseParent`): survives across sessions
  but bakes a per-model decision into history; needs rewind-cleanup and careful
  send-time stripping so custom fields never reach the API. Larger, riskier, and
  wrong under mode switching without extra re-evaluation.
- **Keep branch 1 destructive**: loses rewind fidelity and is unrecoverable
  across a switch to a wider-window model.

## Design

### `src/core/context-management/microcompact.ts`

- Add a pure send-time helper
  `applyMicrocompactCleared(messages, clearedToolUseIds)`: returns a copy with the
  content of any `tool_result` block whose `tool_use_id ∈ clearedToolUseIds`
  replaced by `MICROCOMPACT_CLEARED_PLACEHOLDER`. Idempotent; returns the same
  reference when nothing matches. (Selection logic in `microcompactToolResults`
  is unchanged — it already returns `clearedToolUseIds` and never mutates input.)

### `src/core/context-management/index.ts` (`manageContext`)

- `ContextManagementResult` gains `microcompactClearedToolUseIds?: string[]`.
- The pre-pass still calls `microcompactToolResults` for the freed-token estimate
  and to obtain `clearedToolUseIds`, but **no longer threads the cleared copy into
  condense/truncate and no longer returns it for persistence**:
    - quiet path → return **pristine** `messages` + `microcompactClearedToolUseIds`.
    - condense path → summarize **pristine** `messages`; include the ids.
    - truncate path → truncate **pristine** `messages`; include the ids.
    - no-op path → pristine `messages` + ids.
- Net: `manageContext` never returns mutated tool content; the only persisted
  changes remain condense tags + truncation tags (unchanged).

### `src/core/task/Task.ts`

- New transient field `microcompactedToolUseIds: Set<string> = new Set()` (NOT
  persisted, reset per request by the context manager).

### `src/core/task/TaskContextManager.ts`

- Expose `microcompactedToolUseIds: Set<string>` on `TaskContextManagerAccess`.
- In `manageContextIfNeeded`, after `manageContext` returns, refresh the set
  **in place** (`.clear()` then `.add()` each id) rather than reassigning — always
  (empty when nothing to clear, so a stale set never lingers). In-place mutation is
  load-bearing: `ApiRequestBuilder` captures the Set reference once at construction
  (see below), so reassigning a fresh `new Set(...)` would leave the builder
  reading a dead reference.

### `src/core/task/ApiRequestBuilder.ts` (+ `TaskApiLoop.ts` wiring)

- Expose `microcompactedToolUseIds: ReadonlySet<string>` on
  `ApiRequestBuilderAccess`, and `Set<string>` on `TaskApiLoopAccess`. The
  `TaskApiLoop` constructor passes `access.microcompactedToolUseIds` (the live
  `Task` field, initialized before the loop is built) into the builder's access
  literal, so all three holders — `Task`, `TaskContextManager`, `ApiRequestBuilder`
  — share one Set object; the manager's in-place mutation propagates to the builder.
- At the top of `buildCleanConversationHistory`, when the set is non-empty, run
  `applyMicrocompactCleared` on the incoming messages before the existing
  reasoning/clean loop. Covers both send paths (TaskApiLoop + ApiRequestBuilder)
  via the single shared impl.

## Tests

`src/core/context-management/__tests__/microcompact.spec.ts` (update branch 1's
integration contract):

- quiet path: `result.messages === messages` (pristine, no mutation),
  `result.microcompactClearedToolUseIds` lists the old ids, original content
  intact, `microcompacted === true`.
- escalation: condense runs on pristine messages; ids still returned.

`src/core/context-management/__tests__/microcompact-nondestructive.spec.ts` (new):

- `applyMicrocompactCleared`: clears only listed ids' content; leaves others and
  non-tool blocks intact; idempotent; same-ref no-op on empty set.
- send-time + stored-fidelity: given a history and a cleared-id set, the outgoing
  (stripped) messages show the placeholder while the source array is unchanged
  (proves non-destructive). Rewind fidelity follows from the source being pristine.
- mode-switch: an empty cleared-id set (wide-window model) strips nothing even
  when old bulky results exist.

## Known limitations / tradeoffs

- The cleared-id set is recomputed only on requests where context management runs
  (`contextTokens` truthy). The first request (no usage yet) has an empty set —
  correct, since there is no overflow to manage.
- The strip is keyed by `tool_use_id`, so it only affects native
  `tool_use`/`tool_result` histories (the path this fork uses); classic XML-text
  tool output is untouched (safe).
- Slightly higher summary-input cost than branch 1 when condense escalates
  (condense now sees full old tool content instead of the cleared copy), bought
  back by pristine rewind + correct mode-switch behavior. Summaries are
  ~constant-size output, so the delta is small.
