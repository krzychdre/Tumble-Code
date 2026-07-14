# Code review findings: Roo Code efficiency stack (WS-0 → WS-6)

Date: 2026-07-13
Reviewer pass: full per-branch diff review + test runs (54 tests green)
Reviewed line: `main` (359ea2407) → `feat/agent-efficiency-benchmark` (829a6d0a0) →
`feat/output-efficiency-prompt` (645452601) → `feat/env-details-diet` (5071efa8a) →
`feat/concurrent-safe-tools` (8b995b3d2) → `fix/orchestrator-subtask-overhead` (326715db8)
→ `feat/text-completion-fallback` (cbe8fcea2) → `spike/zai-cache-verify` (fafdea71c)
Parent plan: [2026-07-12_glm-agent-loop-efficiency-implementation.md](2026-07-12_glm-agent-loop-efficiency-implementation.md)
Parent analysis: [2026-07-12_glm-agent-loop-efficiency.md](2026-07-12_glm-agent-loop-efficiency.md)

> This doc lists findings a subagent should **fix / challenge / implement**. Each item
> is tagged with the action expected, the branch it applies to, and the evidence.
> Important findings (I-_) are blockers or correctness gaps; suggestions (S-_) are
> polish. Gate decisions are at the bottom.

---

## What was done well (do not re-litigate)

- **Evidence-first.** Every WS cites measured data (22 s decode/turn vs 1.3 s TTFT;
  0/10.7M cacheReads). The plan challenged/rejected its own hypotheses (WS-5 demoted
  after measurement; WS-3 concurrent-reads dropped with rationale). Correct and rare.
- **WS-0 telemetry is race-correct.** [`createUsageMetricsDrain()`](src/core/task/TaskStreamProcessor.ts:792)
  snapshots ttftMs/reasoningChars/toolCount at drain creation, so the fire-and-forget
  drain can't read the next request's reset state. The exact bug class the plan warned
  about — preempted.
- **WS-5 reused the real tool instead of extracting a helper.**
  [`tryTextCompletionFallback()`](src/core/task/TaskApiLoop.ts:792) drives the actual
  [`AttemptCompletionTool.execute()`](src/core/tools/AttemptCompletionTool.ts:40), so
  delegation gates, cancel-race protection, and the real completion ask all behave
  identically. Can't drift from the tool — better than the plan's extract-a-helper proposal.
- **WS-3 guards are sound.** Read-only/write-tool partitioning, the "every earlier block
  read-only" check, double-fire prevention, and the await-before-edit invariant preserve
  "checkpoint exists before write."
- **WS-2 mode-switch safe.** `WeakMap<Task, ...>` keyed per-Task; `includeFileDetails`
  forces full re-emit; comparison string embeds `<model>`.

---

## Important findings (fix or challenge)

### I-1. Stack base diverges from the plan — RESOLVED 2026-07-13: false alarm, plan doc was stale

The implementation plan ([line 6](2026-07-12_glm-agent-loop-efficiency-implementation.md:6))
stated: _"Base: installed stack tip `fix/delegated-child-return-after-cancel` (a9474a665),
NOT main."_ The actual stack sits directly on `main` (359ea2407) — and that is correct.

**Resolution (verified):** the fix-stack lineage was **squash-merged to `main` via
PRs #98–#118** between the plan being written (2026-07-12) and the stack being built.
Squash merges rewrite SHAs, so `git merge-base --is-ancestor a9474a665 359ea2407`
returns "NOT in main" — that check is the wrong tool across a squash-merge boundary
and must not be used to conclude a rebase is needed. The _content_ check passes:
`tryReattachDelegatedParent` — the exact fix WS-5 depends on — exists in main's
[`AttemptCompletionTool.ts:34`](src/core/tools/AttemptCompletionTool.ts:34) and is
called in the delegation path at
[`AttemptCompletionTool.ts:128`](src/core/tools/AttemptCompletionTool.ts:128), complete
with the five-condition re-stamp guard from that fix. Main's recent history shows the
stack's tail (#116, #117, #118) directly.

**Action (done):** plan doc's Base line updated to reflect that `main` post-#118 is the
base. **No rebase.** Not a blocker; WS-3/WS-5 delegation-safety claims hold on `main`.

---

### I-2. WS-4 ships half the plan — missing deliverable + tests — IMPLEMENT

[`WS-4`](2026-07-12_glm-agent-loop-efficiency-implementation.md:143) specified two changes:

1. Delegation-cost steering — **shipped** ([`mode.ts:240`](packages/types/src/mode.ts:240)
    - [`new_task.ts:5`](src/core/prompts/tools/native-tools/new_task.ts:5)). Safe,
      consistent with the size-based delegation guidance.
2. _"Audit which sections are dead weight for one-shot subagents (modes list, MCP
   catalog when no MCP tools allowed) and drop them for subtask contexts only"_ —
   **not shipped.** Diff is 3 lines across 2 files, no prompt-assembly change.

The plan also required _"prompt snapshots; one orchestrator e2e making sure delegation
still functions"_ — **no tests added.**

**Action (implement):**

- Either implement the subtask system-prompt audit (drop modes list / MCP catalog when
  the subtask context disallows them) **or** formally close WS-4's second deliverable
  with a written rationale (e.g. "blast radius too high for the measured gain; deferred
  to a benchmark-gated revisit"). Do not leave it silently incomplete.
  Note supporting closure (added 2026-07-13): the audit collides with the mid-task
  mode-switching requirement — a user can switch a subtask's mode mid-task, and a
  system prompt assembled without the modes list would be stale after the switch.
  Any implementation must recompute the sections on mode switch, which raises the
  blast radius well above the 3-line shipped half.
- Add the missing prompt snapshot test and (per AGENTS.md test-placement guidance) place
  the orchestrator delegation smoke at the lowest layer that proves delegation still
  functions; only escalate to e2e if lower layers can't represent it.

**Severity: spec-completeness.** The shipped half is merge-safe; the gap is documented
process, not a code defect.

---

### I-3. WS-5 todo-gate diverges from the real tool's gate — FIX

[`tryTextCompletionFallback`](src/core/task/TaskApiLoop.ts:808) gates on:

```ts
Array.isArray(todoList) && todoList.some((todo) => todo?.status !== "completed")
```

The real [`AttemptCompletionTool`](src/core/tools/AttemptCompletionTool.ts:57) gates on:

```ts
task.todoList && task.todoList.some((todo) => todo.status !== "completed")
```

**and** respects the [`preventCompletionWithOpenTodos`](src/core/tools/AttemptCompletionTool.ts:53)
setting (`vscode.workspace.getConfiguration(...).get("preventCompletionWithOpenTodos", false)`).

**Re-assessed 2026-07-13: the divergence is intentional and load-bearing — do NOT align
the gates on the setting.** The two gates guard different decisions:

- The real tool gates an _explicit_ `attempt_completion` call the model chose to make.
  `preventCompletionWithOpenTodos` (default **false**) lets the user decide whether that
  explicit call may proceed with open todos.
- The fallback gates an _inference_ — treating a text-only response as if it were a
  completion. If the fallback honored the setting, then on defaults a narrating weak
  model (GLM — the exact model WS-5 exists for) emitting mid-task text with open todos
  would be **auto-completed**. The fallback's own comment states the invariant: "a
  narrating model mid-task must not complete by accident." The cost of the stricter
  gate is one noToolsUsed retry turn in a corner case — exactly the pre-WS-5 behavior.
- The `Array.isArray` difference is theoretical: `todoList` is typed as an array; a
  truthy non-array requires a type violation elsewhere.

**Action (revised):** optionally extract a shared `hasIncompleteTodos(todoList)`
predicate so the _todo-scan logic_ can't drift — but the fallback must keep applying it
unconditionally, without reading `preventCompletionWithOpenTodos`. Do not implement the
original "both paths honor the setting" proposal; it would regress the weak-model
safety WS-5 was built for.

**Severity: no action required.** Shared-helper extraction is optional polish.

---

### I-4. WS-5 missing the required subtask e2e — IMPLEMENT

The plan required _"subtask e2e: parent receives the text result."_ The added
[`TaskApiLoop.text-completion-fallback.spec.ts`](src/core/task/__tests__/TaskApiLoop.text-completion-fallback.spec.ts:1)
mocks [`attemptCompletionTool`](src/core/task/__tests__/TaskApiLoop.text-completion-fallback.spec.ts:11)
entirely, so the delegation → parent-return integration is untested at any layer. The
unit test asserts the tool is _called_ with the right params, not that a parent task
actually receives the result through [`reopenParentFromDelegation`](src/core/tools/AttemptCompletionTool.ts:203).

**Action (implement):** add a test (lowest sufficient layer per AGENTS.md) that verifies
a text-only completion in a child task propagates the result to the parent via the
delegation flow. Given I-1, this gap is the most concerning — the riskiest integration
path is the least tested. If I-1 resolves to "rebase onto the fix stack," this test
becomes the regression guard for that lineage too.

**Severity: test gap on the riskiest path.** Strongly recommended before relying on the
delegation path in production.

---

## Suggestions (polish, non-blocking)

### S-1. WS-3: orphan checkpoint on abort — DOCUMENT or FIX

[`resetStreamingState()`](src/core/task/TaskStreamProcessor.ts:177) clears
[`pendingCheckpointSave`](src/core/task/Task.ts:452) without awaiting the in-flight
shadow-git commit. On abort mid-stream this leaves a possibly-spurious pre-edit
checkpoint. Harmless (checkpoints are restorable, not destructive) but it accrues
shadow-git state.

**Action:** either await with a bounded timeout before clearing, or add a code comment
documenting that the orphan is intentional (checkpoints are idempotent restorables).

### S-2. WS-0 collector dead fields — FIX

[`collect.py`](scripts/agent-bench/collect.py:87) accumulates `text_chars` and
`req_count` but neither appears in [`fmt_row`](scripts/agent-bench/collect.py:142).
Either surface them in the output table (the plan lists "reasoning chars/turn" —
`text_chars` is the visible-text analog, useful for the WS-1 before/after) or drop the
dead accumulation. Throwaway script, low priority.

### S-3. WS-6 instrumentation lifecycle — DECIDE

[`processUsageMetrics`](src/api/providers/base-openai-compatible-provider.ts:208) gained
an env-gated `console.log` (`ROO_LOG_RAW_USAGE=1`). Default-off means zero hot-path cost
— fine to keep. But the lifecycle depends on the WS-6 probe verdict:

**Action:** run the probe ([`zai-cache-probe.mjs`](scripts/agent-bench/zai-cache-probe.mjs:1)):
`ZAI_API_KEY=... node scripts/agent-bench/zai-cache-probe.mjs`

- If verdict = "no cached_tokens reported" → close WS-7, **remove** the instrumentation
  rather than leaving spike scaffolding in a provider hot path. Write the decision into
  this doc.
- If verdict = "caching works" → WS-7 proceeds; promote the `console.log` to a structured
  debug log (filterable, not raw console) and keep it.

### S-4. WS-2: add an explicit model-change-within-mode test — IMPLEMENT

The plan called out mode-switch re-emission (tested). The model-id-change-within-same-mode
path is structurally covered (comparison string embeds [`<model>`](src/core/environment/getEnvironmentDetails.ts:263))
but has no explicit test.

**Action:** add a 2-line test to the existing [`change-only sections`](src/core/environment/__tests__/getEnvironmentDetails.spec.ts:449)
block: same mode slug, different model id → expects re-emission. Locks the behavior
against future refactors that might split mode from model.

---

## Per-branch gate decisions

| WS  | Branch                              | Decision                 | Rationale                                                                                                                                       |
| --- | ----------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `feat/agent-efficiency-benchmark`   | ✅ MERGE                 | Clean measurement harness; telemetry race-correct; gate for the rest                                                                            |
| 1   | `feat/output-efficiency-prompt`     | ✅ MERGE                 | Matches plan exactly; snapshots updated; zero risk; single-line rollback                                                                        |
| 2   | `feat/env-details-diet`             | ✅ MERGE (S-4 follow-up) | Solid; test coverage matches plan; WeakMap lifecycle correct                                                                                    |
| 3   | `feat/concurrent-safe-tools`        | ✅ MERGE (S-1 follow-up) | Highest-risk WS but well-guarded; eager checkpoint invariant preserved; reduced scope was the right call                                        |
| 4   | `fix/orchestrator-subtask-overhead` | ⚠️ MERGE, reopen for I-2 | Shipped half is safe; missing subtask-prompt audit + tests vs. plan                                                                             |
| 5   | `feat/text-completion-fallback`     | ⚠️ MERGE, follow-up I-4  | Sound reuse of real tool; todo-gate divergence is intentional (I-3 re-assessed, no action); needs subtask e2e before relying on delegation path |
| 6   | `spike/zai-cache-verify`            | 🔶 HOLD — spike          | Merge only if keeping instrumentation; otherwise close with a decision doc recording the probe verdict                                          |

## Merge order & blockers

1. ~~Resolve I-1 first~~ **Resolved 2026-07-13**: fix-stack content is in `main` via
   squash-merged PRs #98–#118; plan doc Base line updated; no rebase.
2. WS-0 → WS-1 → WS-2 → WS-3 are merge-ready as-is.
3. WS-4/WS-5 are safe to merge with tracked follow-ups (I-2/I-4; I-3 closed as no-action).
4. Run the WS-6 probe (S-3) and record the verdict before starting WS-7/WS-8.

## Missing workstreams (not yet branched — by design)

- **WS-7 `feat/zai-prefix-stability`** — gated on WS-6 probe verdict (S-3). Chunked
  microcompact + session-frozen tool schema ordering + surface cacheReads in cost.
- **WS-8 `feat/read-dedup-stub`** — file-freshness read dedup (microcompact-aware).
  The microcompact interlock (referenced tool_result may have been cleared) is the
  critical test case per the plan.

## Net assessment

Disciplined, measurement-gated efficiency initiative. Deviations from plan are either
improvements (WS-5 reuse-vs-extract) or honest scope reductions (WS-3 concurrent-reads
dropped). After the 2026-07-13 re-assessment, the base-branch discrepancy (I-1) turned
out to be a squash-merge SHA artifact, not a real divergence, and the todo-gate
divergence (I-3) is intentional weak-model safety. The one remaining real risk is the
untested delegation integration (I-4) — fixable without reworking any shipped code.
