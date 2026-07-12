# Fix Stack 4 — Tech-Debt Refactor Stack (2026-07-12)

Companion to [`2026-07-11_codebase-review-findings-register.md`](./2026-07-11_codebase-review-findings-register.md).
All 38 discrete findings are ✅ DONE (stacks 1–3, B1–B24). This stack works through
the register's 📝 tech-debt notes: refactors and hardening with no discrete bug,
selected for maintainability (low cognitive complexity) and efficiency. Stacked
linearly on `fix/autodream-trigger-unhandled-rejection`; build from the new tip.

Refactor discipline: behavior-preserving unless stated; full existing test suites
must stay green; new behavior (B32, B33) gets failing-test-first TDD.

## Branches (in stacking order)

### B25 `refactor/cloudapi-shared-format-utils`

Duplicate `_num`/`_fmt_tokens`/`_fmt_duration` across `web.py` and
`metrics_service.py` was the root cause of CB-7's drift. Extract one shared util
module; both import it. Pytest green.

### B26 `refactor/decoration-controller-lazy`

`DecorationController` calls `vscode.window.createTextEditorDecorationType` at
MODULE scope — any transitive importer needs a fully-mocked `vscode` or the import
itself throws. Make decoration-type creation lazy (first use), keeping controller
behavior identical.

### B27 `refactor/diffview-provider-split`

`DiffViewProvider` is a 1046-line god object (editor lifecycle + decorations +
save/revert/diagnostics + recovery buffers + tab cleanup + BOM). Extract:

- `DiagnosticsCollector` — diagnostics capture/compare around edits;
- `DiffEditorLifecycleManager` — open/tab management/close/scroll of the diff editor.
  `DiffViewProvider` keeps its public API (tools depend on it) and delegates.
  Behavior-preserving; the `pendingSave` recovery-buffer invariants move verbatim with
  their comments.

### B28 `refactor/abort-task-split`

`TaskLifecycle.abortTask` (~line 535) is a ~70-line method with 5 responsibilities.
Split into private `prepareAbort()` / `drainAbort()` / `cleanupAbort()` so ordering
is explicit. No behavior change; abort specs stay green.

### B29 `refactor/task-abort-event-helper` — DROPPED after investigation

Verified on the current tree: the "duplicated" abort-listener + `finally { off }`
pattern exists exactly ONCE (`RunParallelTasksTool.ts:329-345`); the other two
Task-event wirings (`ClineProvider.ts:297-308` bulk provider events,
`:3187-3195` `awaitTaskCompletion` promise-resolve) have different shapes. A
helper with a single call site adds indirection without removing duplication.
The register note predates the fix-stack changes that simplified these paths.

### B30 `refactor/memory-tech-debt`

- Cursor map eviction is FIFO, not LRU (`extractMemories.ts`, 64-entry cap):
  touch-on-read so a long-lived task's cursor isn't evicted by short-lived ids.
- `memoryWriteSandbox` only checks `parsed.path`: also scan the other known
  path-bearing fields (`file_path`, and any write-capable field found by
  inspecting current write tools) so a future write-bearing field can't slip past.

### B31 `refactor/streaming-shared-delta-helpers`

Scoped slice of "unify the three streaming impls": extract the shared OpenAI
delta→ApiStream chunk logic (content, reasoning extraction, tool_call_partial
emission, finish_reason yield) into one helper used by the raw-SDK family
(`base-openai-compatible-provider`, `deepseek`, `lm-studio`, `qwen-code`,
`openrouter`). Full unification (raw SDK vs Vercel AI SDK vs `openai.ts` O3
branching) is out of scope — deferred below.

### B32 `fix/condense-keep-boundary-tool-pairs` (TDD — behavior change)

`computeCondenseKeepBoundary` bounds its pull-back at `keepRecent*2`; long
interleaved tool_use/tool_result chains can land the boundary on a split pair, and
`getEffectiveApiHistory` then drops the orphaned tool_result — silent context loss
for multi-tool weak-model workflows. Fix: never return a boundary that splits a
tool_use/tool_result pair (extend the pull-back past the bound when needed, with a
hard floor to avoid keeping everything).

### B33 `fix/cloud-degradation-signals` (TDD — behavior change)

- `BridgeOrchestrator` registers no `connect_error` / `reconnect_failed` listeners —
  repeated auth-refresh failures reconnect-loop with no user-visible signal. Add
  listeners that log with backoff context.
- `extension.ts:248` `CloudService.createInstance` isn't try/caught — a throwing
  `WebAuthService.initialize()` fails WHOLE-extension activation. Guard it: log and
  degrade to local-only.

## Deferred (with reasons)

- **Full streaming unification** (one impl for raw SDK / Vercel AI SDK / `openai.ts`
  O3): architectural project, high regression risk in one session; B31 extracts the
  shared robustness core, and B7/B8/B22 already converged the divergent behavior.
- **`getApiMetrics` O(n) per-message rescan**: a snapshot cache exists; incremental
  accumulation risks drift with condense/edit paths. Revisit with profiling data.
- **`TaskStreamProcessor` usage accumulation double-count**: needs a per-provider
  audit of incremental-vs-cumulative usage semantics first.
- **Dream session-gate `lastModified`**: `HistoryItem` has no last-modified field;
  needs a data-model change.
- **`pendingSave` recovery-buffer fragility**: invariants move intact in B27;
  further simplification needs its own design.

## Outcome (2026-07-12, end of session)

All planned branches shipped except B29 (dropped, see above). Stack order as built:
B25 → B26 → B27 → B28 → B30 → B31 → B32 → B33; new tip
`fix/cloud-degradation-signals`. Review pass caught and fixed four agent issues
before commit: a local-variable shadow of `num` in the shared format util (B25);
`openDiffEditor` taking state via temporally-coupled mutable fields instead of
params (B27); a dead `files: [{path}]` array-scan branch in the sandbox that never
executed (B30, +2 tests); the dropped `Array.isArray` guard in the shared tool-call
emitter that a malformed proxied backend could crash (B31). B33 review restored the
soft-fail semantics of telemetry registration inside the new activation guard.
Also repaired in passing: 8 pre-existing stale `DiffViewProvider.spec.ts` failures
(B27 phase 1) and the broken `extension.spec.ts` mock context (B33).
Verification on tip: src sweep 1428 passed / 1 skipped (102 files, no unhandled
errors), packages/cloud 299, cloudapi pytest 91, typechecks clean except
pre-existing `zai.ts:129`.

## Discipline

One branch per refactor, stacked. Refactors keep all existing tests green;
behavior changes get failing-test-first. Nothing pushed/merged without the user's
say-so.
