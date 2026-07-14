# Agent-loop efficiency: Roo/Tumble Code (GLM-5.2) vs Claude Code (Opus/Fable)

Date: 2026-07-12
Status: ANALYSIS + PLAN (no code changes yet)
Trigger: "Roo Code feels less efficient than Claude Code — more messages, more turns,
everything takes longer. Is it the model (GLM-5.2 vs Opus/Fable) or the harness?
How do we tighten reasoning without lowering the reasoning setting?"

---

## 1. TL;DR

It is **both, but not in the way one would guess**. The measured data kills the two
"obvious" theories and points at three real levers:

- **NOT tool batching.** This fork already uses native tool calling with
  `parallelToolCalls: true`. GLM-5.2 batches **2.40 tools per tool-turn (47.7% of
  turns are multi-tool)** — _better_ than my own Claude Code sessions on this repo
  (1.06 tools/msg, 5.6% multi-tool; Claude Code compensates with cheap fast turns
  and subagents, not batching).
- **NOT prefill/caching latency.** GLM TTFT is 1.3 s median / 3.8 s mean. Prefill is
  fast even at 47k input tokens. (Caching still matters for **cost** — see §4.3.)
- **The wall clock goes to decode × turn count.** 22 s mean per turn is spent
  generating ~3.3k chars of reasoning + output, times ~9 turns per task. GLM
  re-reasons **from scratch on every turn**, including trivial "one more tool
  result arrived" turns. Opus/Fable has adaptive thinking (spends ~0 on trivial
  turns); GLM at a fixed reasoning-effort setting does not.

Therefore the honest answer to "tighten reasoning without limiting the reasoning
setting" is: **reduce the number of reasoning episodes (turns) and the noise each
episode must re-process** — not the effort knob. Every protocol turn we remove
deletes a full ~900-token reasoning generation.

---

## 2. Evidence (measured, not asserted)

### 2.1 Roo/Tumble + GLM-5.2 — 26 real tasks, 228 API turns

(from `~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks`, most recent 60 dirs)

| Metric                                    | Value                                               |
| ----------------------------------------- | --------------------------------------------------- |
| API turns per task                        | ~8.8 avg                                            |
| Input tokens per turn                     | **47,095 avg** (full history re-sent)               |
| Cache reads                               | **0** across 10.7M input tokens                     |
| Output tokens per turn                    | 1,469                                               |
| Reasoning generated per turn              | 3,329 chars (~900 tok) — on 148/228 turns           |
| Wall-clock per turn                       | **30.8 s mean**                                     |
| — of which TTFT (prefill)                 | 3.8 s mean, **1.3 s median**, 6.8 s p90             |
| — of which decode + tool exec + approvals | **22.0 s mean**, 5.5 s median (long tail)           |
| Tools per tool-turn                       | 2.40; ≥2 tools in 47.7% of tool-turns               |
| `noToolsUsed` retry turns                 | **0** (GLM reliably calls tools/attempt_completion) |
| environment_details                       | ~2,052 chars injected into **every** user message   |
| Visible assistant text per turn           | 394 chars                                           |

### 2.2 Claude Code (Opus/Fable) — 12 sessions on this repo, 3,096 API msgs

(from `~/.claude/projects/-home-krzych-Projekty-QUB-IT-Roo-Code/*.jsonl`)

| Metric                  | Value                                           |
| ----------------------- | ----------------------------------------------- |
| Cache hit rate          | **97.5%** (711M cache-read of 729M total input) |
| Uncached input per turn | **~5,944** (vs 235k effective context)          |
| Output tokens per turn  | 1,027                                           |
| Tools per tool-message  | 1.06; ≥2 tools in only 5.6%                     |

### 2.3 What each harness actually does (code-level)

Roo (this fork):

- Native tool protocol, multi-tool encouraged ([tool-use.ts:6](src/core/prompts/sections/tool-use.ts#L6)), `parallelToolCalls: true` ([TaskApiLoop.ts:1035](src/core/task/TaskApiLoop.ts#L1035)).
- Multi-tool messages execute **sequentially** (`presentAssistantMessage` walks blocks one by one); no concurrency even for read-only tools.
- Loop ends **only** via `attempt_completion`; a text-only answer triggers a `noToolsUsed` retry turn ([TaskApiLoop.ts:279](src/core/task/TaskApiLoop.ts#L279)).
- `environment_details` (visible files, open tabs, terminals, **time, cost**, mode, todo reminder) attached to every user message ([getEnvironmentDetails.ts](src/core/environment/getEnvironmentDetails.ts)).
- System prompt ≈ 25–35k chars; `rules.ts` alone 9.3 kB; **zero conciseness/output-efficiency steering** (grep confirms: no "be concise/brief" rules).
- Prompt caching implemented only for Anthropic/Bedrock/Vertex/Gemini; **nothing for Z.ai** — but Z.ai caching is implicit anyway (§4.3).
- GLM reasoning replay across turns already works: `preserveReasoning: true` + `convertToZAiFormat` keeps `reasoning_content` and avoids user-role messages that would drop it ([zai-format.ts:44-102](src/api/transform/zai-format.ts#L44-L102)). Good — do not touch.
- Microcompact clears tool results older than the **5 most recent** at send time ([microcompact.ts:39](src/core/context-management/microcompact.ts#L39)) — a _sliding_ window that, once active, mutates the request prefix on every turn.

Claude Code (leaked src):

- Ends turn by simply not calling tools — **no attempt_completion**, no terminal turn.
- Static context injected **once** (CLAUDE.md + date as first cached message; git status as a start-of-conversation snapshot); per-turn attachments only when something changed (file-state dedup).
- Three-tier cache_control breakpoints; tool schemas session-frozen specifically to avoid cache busts; "sticky" beta headers for the same reason.
- Heavy conciseness steering: "Go straight to the point", "keep text between tool calls ≤25 words", "lead with the answer".
- Read dedup: unchanged file re-read returns a stub ("~18% of Read calls are same-file collisions").
- Concurrency-safe tools run in parallel (up to 10) and start executing **while the response still streams**.
- Permissions/approvals fully outside the conversation; Haiku offloads labels/summaries off the critical path.

---

## 3. Root-cause attribution: model vs harness

**Model share (GLM-5.2, inherent — you accept this by choosing the model):**

1. Fixed-effort thinking fires on _every_ turn (~900 tok), even "tool result arrived,
   call the next obvious tool". Opus/Fable adaptive thinking spends near-zero there.
   This is the single biggest per-turn time cost and is a model property.
2. Slower convergence: more exploratory steps, occasional redundant re-reads.
3. Decode speed of the Z.ai coding endpoint is what it is.

**Harness share (Roo — fixable):**

1. **Protocol turns**: the mandatory `attempt_completion` finale is a full extra
   turn (47k prefill + fresh reasoning) whose only content is "I'm done" — ~11% of
   all turns at ~9 turns/task. Subtask fan-out (architect/orchestrator) multiplies
   whole conversations, each with its own 25–35k-char system prompt and finale turn.
2. **No conciseness steering** → longer visible output per turn than Claude Code
   (394 chars text + GLM's chatty summaries) on a slow decoder.
3. **Per-turn noise**: ~2 kB environment_details every turn (incl. second-precision
   time and running cost — guaranteed churn), 9.3 kB rules section — noise a weak
   model re-reads and re-reasons about every episode.
4. **Serial tool execution** inside a multi-tool turn; checkpoint saves and approval
   waits sit on the critical path (part of the 22 s decode-side tail).
5. **Cache economics ignored for Z.ai**: 10.7M input tokens billed at full rate;
   Z.ai supports implicit prefix caching at ~1/5 input price with
   `prompt_tokens_details.cached_tokens` reporting — we read that field correctly
   but got 0, so either the coding endpoint doesn't cache/report, or our prefix
   isn't byte-stable (microcompact sliding window is one confirmed prefix mutator).
6. **Perception**: Roo's UI renders reasoning, every tool call, api_req and asks as
   separate chat bubbles; Claude Code collapses them. Part of "I see more messages"
   is presentation, not extra API traffic.

**Clean separation experiment** (cheap, do first): run the same 3 benchmark tasks in
Roo with a Claude (Sonnet/Opus) profile vs GLM-5.2. If turns/task drop sharply with
Claude in the _same_ harness → model-dominated; if Roo+Claude still needs far more
turns than Claude Code+Claude → harness-dominated. Expected: ~60/40 model/harness on
wall-clock, but the harness items below are the part we control.

---

## 4. Ideas considered — kept, reshaped, or rejected

### KEPT

**A. Text-only response = completion (kill the finale turn).**
When the model replies with no tool calls, don't send the `noToolsUsed` retry;
treat the text as the completion result (auto-wrap as `attempt_completion` so the
UI and subtask return-value contract stay intact).
_Challenge:_ weak models may stop prematurely mid-task. _Mitigation:_ only
auto-complete when there is no pending todo item; otherwise keep today's retry.
_Challenge 2 — CORRECTED after measurement (see implementation plan):_ all 11
completed GLM tasks end with a lone attempt_completion turn, but a text-only final
response would cost the **same** number of turns — so this is a robustness change
(text-only responses from weaker/local models, Q&A flows) and a prerequisite for a
flag-gated completion-batching experiment, not a turn saver by itself. Demoted in
the implementation ordering.

**B. Conciseness/output-efficiency section in the system prompt** (new ~15-line
section, weak-model-proof: short imperative rules, no prose): lead with the action,
≤1 short sentence between tool calls, no restating the request, no plan narration
before tool calls, final summary ≤100 words unless asked. Ported from Claude Code's
`getOutputEfficiencySection`. Cuts decode tokens on every turn of a slow decoder.
_Challenge:_ visible text is only ~394 chars/turn — modest win on its own; but GLM
also mirrors instructions into its reasoning, and shorter expected output shortens
reasoning episodes. Cheap, zero-risk, do it — but measure, don't over-claim.

**C. environment_details diet + change-only sections.**

- Drop per-turn **time** (or round to minute) and **cost** from the payload — they
  guarantee every message differs and add zero task value (cost belongs in the UI).
- Send visible-files / open-tabs / mode **only when changed** since last turn
  (transient recompute, consistent with the mode-switching design rule).
- Keep: todo reminder, recently-modified files, terminal output on change.
  _Challenge:_ some flows key off env_details (todo reminder drives behavior; tests
  assert exact blocks). Scope carefully; sections behind existing settings already.
  Saves ~1.5 kB/turn of input noise and stabilizes the message tail for caching.

**D. Concurrent execution of concurrency-safe tools.** Port Claude Code's
`isConcurrencySafe` partitioning: reads/searches/list in a multi-tool message run
in parallel (cap ~8); writes stay serial. Also move checkpoint saves off the
critical path (fire-and-forget with completion barrier before the next write).
_Challenge:_ approval UI for simultaneous asks — restrict concurrency to
auto-approved tools first (read-only set), which is where the win is anyway.

**E. Z.ai cache verification + prefix stability (cost, tail latency).**

1. Controlled test: two identical requests to the coding endpoint; log raw
   `usage.prompt_tokens_details`. Determines whether cached_tokens is simply not
   reported (then only fix cost accounting) or caching genuinely never hits.
2. If caching works: freeze tool-schema ordering per session, verify system prompt
   is byte-stable within a task, and change microcompact from a per-turn sliding
   window to **chunked clearing** (clear down to a boundary, then leave the prefix
   alone for N turns) so the implicit cache isn't re-busted every turn.
   _Challenge:_ TTFT data says this is NOT the latency bottleneck — treat as cost
   optimization (~up to 5× on the cached share of 10.7M tokens) + p90 tail, priority
   below A–D.

**F. Read dedup (file-freshness stub).** Track path+range+mtime of prior reads;
unchanged re-read returns "unchanged since last read — refer to earlier result".
_Challenge (important interlock):_ microcompact may have **cleared** that earlier
result; dedup must check the referenced tool_result still has content, else re-read.
Claude Code data says ~18% of reads are dup — saves turns _and_ tokens for a weak
model that likes to re-read.

**G. Benchmark + telemetry first (gate for everything above).**
Fixed 5-task benchmark (repeatable on this repo); per-task telemetry already flows
through LLM Completion events — extend with: turns/task, tools/turn, reasoning
chars/turn, TTFT, decode seconds. Every workstream lands with before/after numbers
from the same benchmark; anything that doesn't move the metric gets reverted.

### REJECTED (challenged out)

- **"Switch to/force stronger batching" as the headline fix** — data shows GLM
  already out-batches my Claude Code sessions; pushing harder risks weak models
  emitting parallel calls with hidden dependencies. Keep current guidance; at most
  add one concrete example to `tool-use-guidelines`. Not a workstream.
- **Deferred tools by default** — trades payload for an extra `tools_load` turn;
  turns are exactly what we can't afford on GLM.
- **Lower reasoning_effort / disable thinking** — explicitly out of scope per user
  constraint; also GLM without thinking degrades on this codebase's task mix.
- **Anthropic-style explicit cache_control for Z.ai** — Z.ai caching is implicit;
  there is nothing to send. The work is prefix _stability_, not breakpoints (→ E).
- **Trim the system prompt aggressively (rules.ts rewrite)** — tempting (9.3 kB),
  but high blast radius across all modes/providers and prefill is already fast.
  Revisit only if benchmark shows reasoning length correlates with prompt length.
- **Condense on a cheaper model** — condense is rare (threshold-gated) and
  correctness-critical after the mode-switch design rule; leave as-is for now.
- **Collapsing UI messages** — perception-only; worth a UX ticket, not this plan.

---

## 5. Implementation plan (one branch per workstream, stacked on the current tip)

Order = expected wall-clock impact ÷ risk. Baseline branch: current installed
stack tip (see memory: installed build = branch stack, not main).

| #   | Branch                            | Workstream                                                                                                                                                                    | Success metric (benchmark)                                                        |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 0   | `feat/agent-efficiency-benchmark` | G: 5-task benchmark script + telemetry fields (turns, tools/turn, reasoning chars, TTFT/decode). Also run the Roo+Claude vs Roo+GLM separation experiment and record it here. | Baseline report committed to `ai_plans/`                                          |
| 1   | `feat/text-completion-fallback`   | A: text-only response auto-completes (todo-gated)                                                                                                                             | −1 turn/task and −1 turn/subtask; no premature-stop regressions on benchmark      |
| 2   | `feat/output-efficiency-prompt`   | B: conciseness section (all modes, native protocol)                                                                                                                           | −20%+ visible output chars/turn; reasoning chars/turn measured (hypothesis: −10%) |
| 3   | `feat/env-details-diet`           | C: change-only env sections; drop time/cost churn                                                                                                                             | −1.5 kB/turn input; identical task success on benchmark                           |
| 4   | `feat/concurrent-safe-tools`      | D: parallel read-only tool execution + async checkpoints                                                                                                                      | −15% decode-side wall-clock on multi-read turns                                   |
| 5   | `spike/zai-cache-verify`          | E1 spike: raw usage logging, 2-request cache probe                                                                                                                            | Decision doc: cached_tokens reported?                                             |
| 6   | `feat/zai-prefix-stability`       | E2 (only if E1 positive): chunked microcompact, frozen tool schema order, cacheReads surfaced in cost                                                                         | cacheReads > 0 in real tasks; input cost/task −50%+                               |
| 7   | `feat/read-dedup-stub`            | F: file-freshness read dedup (microcompact-aware)                                                                                                                             | dup-read rate → ~0; no stale-content errors                                       |

Each branch gets its own ai_plans doc at implementation time (per repo rule), with
the root-cause section pointing back to this analysis. All prompt-text changes are
written for weak models first (short, imperative, example-backed) and tested at
minimum against GLM-5.2 + one local model before merge.

## 6. Open questions

1. Does the Z.ai **coding-plan** endpoint report `cached_tokens` at all, or only
   the pay-per-token endpoint? (Spike #5; docs: https://docs.z.ai/guides/capabilities/cache)
2. Does GLM-5.2's reasoning length actually shrink with a cleaner/smaller context
   (B+C hypothesis)? Measured by workstream 0 telemetry before/after 2–3.
3. Subtask overhead: should orchestrator-mode fan-out be discouraged for GLM
   profiles below a size threshold (ties into the existing size-based delegation
   guidance)? Decide after benchmark data on subtask-heavy tasks.
