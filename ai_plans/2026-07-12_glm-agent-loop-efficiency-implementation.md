# Implementation plan: agent-loop efficiency (GLM-5.2 wall-clock)

Date: 2026-07-12
Status: PLAN — ready to implement, one stacked branch per workstream
Parent analysis: [2026-07-12_glm-agent-loop-efficiency.md](2026-07-12_glm-agent-loop-efficiency.md)
Base: installed stack tip `fix/delegated-child-return-after-cancel` (a9474a665), NOT main.

## Correction to the parent analysis (challenged and revised)

The analysis claimed the `attempt_completion` finale "saves ~1 turn/task" if removed.
**Measured: false.** All 11 completed GLM tasks end with a _lone_ attempt_completion
turn (0 batched with other tools) — but a text-only final response would be the same
turn count. The fallback (WS-5) is therefore a **robustness + prerequisite** change,
not a turn saver, and is demoted below the decode-side workstreams. The only real
turn saver in that area is the _completion-batching experiment_ (WS-5b), which is
higher risk and gated behind a flag + benchmark.

Revised lever ranking (decode 22 s/turn is the bottleneck; TTFT 1.3 s is not):

1. Fewer output/reasoning tokens per turn (WS-2, WS-3)
2. Less serial wall-clock inside a turn (WS-4)
3. Fewer whole conversations (subtask policy, WS-6)
4. Robustness/protocol cleanups (WS-5)
5. Cost-only: Z.ai caching (WS-7/8), read dedup (WS-9)

---

## WS-0 `feat/agent-efficiency-benchmark` — measurement harness (gate for all)

**Goal:** every later branch lands with before/after numbers; no metric, no merge.

**Changes:**

- `scripts/agent-bench/`: a runner-independent protocol doc + 5 fixed task prompts
  against this repo (S: "what does X do" Q&A; M: single-file bugfix; M: 3-file
  refactor; L: feature w/ tests; L: architect→code subtask flow). Each run recorded
  by task ID; a `collect.py` (port of the analysis scripts used in the parent doc)
  reads `~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks/<id>` and emits:
  turns, tools/turn, input tok/turn, output tok/turn, reasoning chars/turn, TTFT,
  decode s/turn, cacheReads, total wall-clock.
- Telemetry: extend the existing LLM Completion event (see
  `packages/types/src/telemetry.ts`) with `reasoningChars`, `ttftMs`, `toolCount` —
  the web metrics page (memory: metrics come from LLM Completion telemetry)
  aggregates them for free.
- Run the **separation experiment**: same 5 tasks, Roo+GLM-5.2 vs Roo+Claude
  profile; record turns/task and s/turn split into TTFT/decode. Commit results
  table into this doc. This pins the model-vs-harness ratio with hard numbers.

**Tests:** none beyond script self-check. **Risk:** none.

## WS-1 `feat/output-efficiency-prompt` — conciseness steering

**Goal:** cut decode tokens on every turn (output 1,469 tok/turn today; visible
text + completion summaries are the compressible share).

**Changes:**

- New `src/core/prompts/sections/output-efficiency.ts` (~15 lines, imperative,
  weak-model-proof — no prose, no conditionals):
    - Lead with the action; do not narrate plans before tool calls.
    - At most one short sentence of text before/between tool calls.
    - Never restate the user's request or a file's content back.
    - Final result ≤100 words unless the task demands more.
    - Do not summarize what each tool returned; use results silently.
- Wire into `generatePrompt()` in [system.ts](src/core/prompts/system.ts) after
  `getToolUseGuidelinesSection()`. Applies to all modes.
- Update system-prompt snapshot tests (`src/core/prompts/__tests__/`).

**Verification:** WS-0 benchmark — target ≥20% drop in visible output chars/turn,
measure reasoning chars/turn (hypothesis −10%, report either way). Must be tested
against GLM-5.2 and one local model (design-for-weak-models rule).
**Risk:** low; worst case answers get too terse → tune the ≤100-word line.
**Rollback:** remove section from assembly (one line).

## WS-2 `feat/env-details-diet` — per-turn payload on a diet

**Goal:** remove ~1.5 kB/turn of churn-noise input; stabilize the message tail
(prereq for WS-8 caching); smaller context → shorter GLM reasoning episodes
(hypothesis, measured by WS-0).

**Changes in [getEnvironmentDetails.ts](src/core/environment/getEnvironmentDetails.ts):**

- Defaults flip (settings already exist, line 176): `includeCurrentTime = false`,
  `includeCurrentCost = false`. Cost belongs in the UI; time moves to first turn
  only (weak models still need "today's date" once — keep it in the initial turn's
  block, drop from subsequent turns).
- Change-only sections: new transient (non-persisted, recomputed after mode switch
  — per the mode-switching design rule) `lastEnvSnapshot` hash map on the Task
  instance for {visibleFiles, openTabs, mode}. Unchanged section → omitted entirely
  on turns 2+. First turn after any change (or mode switch) → full section.
- Always kept per turn: todo reminder, recently-modified files, terminal output
  (already change-driven by nature).

**Tests:** `getEnvironmentDetails` unit tests (exact-block assertions will need
updating); add a two-turn test asserting omission + reappearance-on-change; a
mode-switch test asserting full re-emission.
**Risk:** medium-low. A model might ask "which file is open?" after omission —
mitigated because the info was sent when it last changed and remains in history.
**Rollback:** settings defaults back to true; change-dedup behind a single boolean.

## WS-3 `feat/concurrent-safe-tools` — parallel reads + async checkpoints

**Goal:** cut serial wall-clock inside multi-tool turns (47.7% of tool-turns have
≥2 tools; today [presentAssistantMessage](src/core/assistant-message/presentAssistantMessage.ts)
walks blocks strictly sequentially) and take checkpoint saves off the critical path.

**Changes (deliberately narrow to avoid destabilizing the streaming path):**

- Read-only set: `read_file`, `list_files`, `search_files`, `codebase_search`,
  `list_code_definition_names`. When a completed assistant message contains ≥2
  tool_use blocks and a _consecutive run_ of them are all in the read-only set AND
  all auto-approved, execute that run with `Promise.all` (cap 8), then emit results
  in original block order (result ordering must stay deterministic for history).
  Any non-read tool ends the run and falls back to the existing sequential path.
  Implemented as a pre-pass in `presentAssistantMessage` operating only on
  non-partial blocks (streaming/partial blocks keep today's behavior untouched).
- Async checkpoints: `checkpointSaveAndMark` before write tools becomes
  fire-and-forget with an await-barrier before the _next_ write tool executes
  (correctness: a checkpoint must exist before its write lands; two writes never
  interleave because writes stay serial).
- Experiment flag `concurrentReadTools` (default on for the fork after one dogfood
  week; the flag exists to bisect regressions, not to hedge forever).

**Tests:** unit test the batch partitioner (runs/ordering/fallback); integration
test: 3 parallel read_file produce identically ordered tool_results as sequential.
**Risk:** medium — this is the most invasive WS. Contained by: post-stream only,
read-only only, auto-approved only, flag.
**Metric:** −15% decode-side wall-clock on the multi-read benchmark task.

## WS-4 `fix/orchestrator-subtask-overhead` — fewer whole conversations

**Goal:** each subtask costs a fresh 25–35 k-char system prompt, its own reasoning
episodes, and its own lone attempt_completion finale. On GLM this multiplies the
dominant cost. Existing guidance work (b2e1ee459, 12086976d) already constrains
fan-out size; this WS adds the efficiency angle.

**Changes:**

- Mode prompt guidance (architect/orchestrator sections): "delegate only units a
  fresh contributor needs isolation for; otherwise use the todo list in-task" —
  one imperative line, consistent with the size-based delegation memory.
- Subtask system prompt: subagents already get mode-appropriate prompts; audit
  which sections are dead weight for one-shot subagents (modes list, MCP catalog
  when no MCP tools allowed) and drop them for subtask contexts only.

**Tests:** prompt snapshots; one orchestrator e2e making sure delegation still
functions. **Risk:** low. **Metric:** turns + tokens on the L subtask benchmark task.

## WS-5 `feat/text-completion-fallback` — protocol robustness (demoted, see correction)

**Goal:** a text-only assistant response ends the task cleanly instead of the
`noToolsUsed` retry ([TaskApiLoop.ts:726-738](src/core/task/TaskApiLoop.ts#L726-L738)).
Zero measured retries for GLM-5.2, but local/weaker models (design-for-weak-models
rule) hit this path, and it is the prerequisite for WS-5b.

**Changes:**

- Extract the completion routine from [AttemptCompletionTool.ts](src/core/tools/AttemptCompletionTool.ts)
  (`say("completion_result")`, TaskCompleted emission, subtask result propagation to
  `finishSubTask`) into a shared `completeTask(task, result)` helper — the tool and
  the fallback both call it.
- In `finalizeStreamAndProcessResults`: when `!didToolUse && hasTextContent`:
    - incomplete todos exist (reuse the `hasIncompleteTodos` predicate,
      [AttemptCompletionTool.ts:57](src/core/tools/AttemptCompletionTool.ts#L57)) →
      keep today's `noToolsUsed` retry;
    - otherwise → `completeTask(assistantText)`, return `"return_true"`.
- `consecutiveNoToolUseCount` only increments on the retry path.

**WS-5b (separate flag `batchedCompletion`, only after WS-0 baseline):** one line in
the completion tool description: "If the current tool call completes the task, you
may include attempt_completion in the same message." This is the only true
turn-saver here (~1 turn/task and per subtask) but risks premature completion on
weak models — benchmark decides, off by default.

**Tests:** TaskApiLoop unit tests for both branches (todo-gated retry vs completion);
subtask e2e: parent receives the text result. **Risk:** low with the todo gate.

## WS-6 `spike/zai-cache-verify` — does the coding endpoint cache at all? (cost)

**Changes:** debug env var (`ROO_LOG_RAW_USAGE=1`) logging the raw final usage chunk
in [base-openai-compatible-provider.ts:205-225](src/api/providers/base-openai-compatible-provider.ts#L205-L225);
a probe script sending the same 20 k-token request twice to the Z.ai coding
endpoint and printing `prompt_tokens_details`. Outcome is a decision doc appended
here: (a) cached_tokens reported → proceed WS-7; (b) not reported/no caching →
close WS-7, note cost is subscription-flat anyway.

## WS-7 `feat/zai-prefix-stability` — keep the implicit cache warm (only if WS-6 = a)

**Changes:**

- Chunked microcompaction: replace the per-turn sliding `MICROCOMPACT_KEEP_RECENT=5`
  window ([microcompact.ts:39](src/core/context-management/microcompact.ts#L39)) with
  hysteresis: once triggered, clear down to `keep=10` and don't re-clear until 10
  new clearable results accumulate — the prefix then stays byte-stable for ~10
  turns between busts instead of mutating every turn.
- Session-frozen tool schema ordering (sort once per task, reuse the array).
- Surface `cacheReads` in the task header cost tooltip so regressions are visible.

**Metric:** cacheReads > 0 on real tasks; input cost/task −50% on the cached share.

## WS-8 `feat/read-dedup-stub` — stop paying for duplicate reads

**Changes:** in `ReadFileTool`, consult the existing `FileContextTracker`
(`task_metadata.json` already tracks `record_state: active/stale` + read dates):
same path+range, file mtime unchanged, `record_state === "active"`, AND the prior
tool_result has not been cleared by microcompact/condense (check the history block
still carries content) → return a one-line stub: "File unchanged since the last
read above — use that content." Otherwise read normally.
**Tests:** dedup hit, mtime-invalidation, microcompact-invalidation (the interlock
is the critical test). **Risk:** low-medium; Claude Code fleet data: ~18% of reads
are duplicates.

---

## Order & stacking

WS-0 → WS-1 → WS-2 → WS-3 → WS-4 → WS-5 → WS-6(spike) → [WS-7] → WS-8, each
branch stacked on the previous (they touch adjacent code: prompts → env → loop).
WS-1/2/3 are expected to carry most of the felt improvement; re-run the full
benchmark after WS-3 and decide whether WS-5b/WS-7 are still worth it.

Every branch: paired ai_plans doc (repo rule), prompt changes validated on GLM-5.2
plus one local model, benchmark numbers in the PR description, single-flag rollback.
