# Tumble Code — Codebase Review & Prioritized Fix Stack (2026-07-11)

Base branch stack tip: `refactor/background-task-loose-ends` (21f11e96d). All fix
branches below stack linearly on top of this tip (installed-build baseline, per
memory `feedback_installed_build_baseline_is_branch_stack`). Every fix is TDD:
failing test first, minimal fix, green.

Reviewers: five Sonnet agents, read-only, one per subsystem (task engine, memory,
tools/diff, api/providers, cloud/bridge). Findings below are only the ones traced
to real code with evidence; speculative/style findings dropped.

## Verification notes (prove-root-cause discipline)

- **`spotted-errors/file-*.md` (`Cannot read properties of undefined (reading 'clear')`
  and `setActiveLine` crash, v3.53.0) — ALREADY FIXED.** Current `DiffViewProvider`
  uses the `ActiveEdit` pattern: `fadedOverlay`/`activeLine` are `readonly` and
  always constructed in `open()` ([DiffViewProvider.ts:141-155]), and `update()`
  guards `if (!edit) throw` ([:167]). The controllers can no longer be undefined
  while `edit` exists. No fix branch — recorded as resolved.
- **`lm-studio.ts:117` `chunk.choices[0]?.delta` — REAL & CURRENT.** `choices`
  itself is not guarded; sibling `base-openai-compatible-provider.ts:141` guards
  with `?.[0]`. Crashes on keepalive / usage-only SSE chunks from local servers.
- **`openai.ts` is the ONLY provider that threads `signal` into the HTTP call**
  (`:251-253`) and implements `cancelRequest`. All OpenAI-compatible / local
  providers do not — confirmed by grep. This is the fork's primary use case.

## Priority tiers

CRITICAL / HIGH first, weighted by (a) fork use-case = local weak models,
(b) confidence, (c) blast radius.

| #   | Branch                                 | Severity        | Area                                        | Confidence |
| --- | -------------------------------------- | --------------- | ------------------------------------------- | ---------- |
| 1   | `fix/local-provider-stream-crash`      | HIGH            | lm-studio stream choices guard              | high       |
| 2   | `fix/local-provider-abort-propagation` | CRITICAL        | abort → HTTP for local providers            | high       |
| 3   | `fix/memory-writers-skip-background`   | HIGH            | memory writer recursion on bg/abort         | high       |
| 4   | `fix/tool-malformed-param-coercion`    | HIGH            | weak-model tool params + fail-safe approval | high       |
| 5   | `fix/cloud-share-authz`                | HIGH (security) | self-hosted share ownership/org checks      | high       |

Deferred (specced, next session): stale `MemoryCoordinator` ApiHandler on profile
switch; autoDream drain/abort + double-fire lock race; usage-chunk-missing →
context-mgmt never condenses; `StaticTokenAuthService` JWT expiry; RetryQueue
`maxRetries:0` infinite; NativeToolCallParser static-state cross-task race.

---

## Branch 1 — `fix/local-provider-stream-crash`

**Files:** `src/api/providers/lm-studio.ts`
**Test:** `src/api/providers/__tests__/lmstudio.spec.ts`

**Bug:** `lm-studio.ts:117-118` `chunk.choices[0]?.delta` / `chunk.choices[0]?.finish_reason`
and `:209` `response.choices[0]?.message.content` throw `TypeError: Cannot read
properties of undefined (reading '0')` when a local server emits an SSE chunk with
`choices: undefined` (keepalive) or a usage-only final chunk. Crashes the stream,
forces a needless retry, drops the partial generation.

**Fix:** `chunk.choices?.[0]?.delta`, `chunk.choices?.[0]?.finish_reason`,
`response.choices?.[0]?.message?.content`. Match `base-openai-compatible-provider.ts`.

**TDD:** stream mock yields `{ choices: undefined }` then a normal delta chunk;
assert no throw and normal content is yielded. Second test: usage-only final chunk
(`{ choices: [], usage: {...} }`).

---

## Branch 2 — `fix/local-provider-abort-propagation` (CRITICAL)

**Files:** `src/api/providers/base-openai-compatible-provider.ts`,
`src/api/providers/lm-studio.ts`, `src/api/providers/native-ollama.ts`
**Test:** `src/api/providers/__tests__/base-openai-compatible-provider.spec.ts`,
`lmstudio.spec.ts`

**Bug:** On user cancel, `TaskLifecycle.cancelCurrentRequest()` calls
`currentRequestAbortController.abort()` (stops the read loop) then
`api.cancelRequest?.()`. But `BaseOpenAiCompatibleProvider` and its subclasses
(DeepSeek, Fireworks, Sambanova, LM Studio, Ollama, …) never pass an `AbortSignal`
to `client.chat.completions.create()` and don't implement `cancelRequest`. The
underlying HTTP request to the local inference server keeps generating — burning
GPU and blocking the next request on single-user servers. Only `openai.ts` does
this correctly (`:251-253`, `:135-146`).

**Fix:** Give `BaseOpenAiCompatibleProvider` a per-request `AbortController`
(mirroring `openai.ts`): pass `{ signal }` as request options to
`chat.completions.create`, implement `cancelRequest(destroyClient?)` that aborts
and optionally nulls the client. Thread the same into `lm-studio.ts` and
`native-ollama.ts` (Ollama SDK accepts an abort signal). Ensure the created signal
is composed with any caller-provided signal so an in-flight `for await` throws
`APIUserAbortError` promptly.

**TDD:** mock `chat.completions.create`, assert the 2nd arg contains
`{ signal: <AbortSignal> }`. Call `cancelRequest()`, assert `abort()` fired and the
in-flight async iterator rejects. Regression: normal completion still yields.

---

## Branch 3 — `fix/memory-writers-skip-background`

**Files:** `src/core/task/TaskLifecycle.ts`, `src/core/task/TaskApiLoop.ts`,
the `TaskLifecycleAccess` interface
**Test:** `src/core/task/__tests__/TaskLifecycle.abort-memory-writers.spec.ts`

**Bug A:** `abortTask` (`TaskLifecycle.ts:557-564`) guards
`triggerMemoryBackgroundWriters()` on `!isAbandoned && !isUserCancelled` but NOT on
`isBackground`. Background tasks (memory writers, parallel subagents) have no
`parentTaskId`, so `triggerMemoryBackgroundWriters` treats them as a main agent and
spawns another memory writer — which can itself be aborted, spawning another:
unbounded recursion. `TaskCompleted` already guards `if (this.isBackground) return`
(`Task.ts:756`); `abortTask` must too. `TaskLifecycleAccess` doesn't even expose
`isBackground`.

**Bug B:** `TaskApiLoop.ts:278-283` — on `maxAgentTurns`, `abortTask()` is called
with no `abortReason`, so `isUserCancelled` is false and writers fire on a
background task (same recursion path).

**Fix:** Add `isBackground: boolean` to `TaskLifecycleAccess`; skip
`triggerMemoryBackgroundWriters()` AND `drainPendingExtraction()` when
`this.access.isBackground`. Belt-and-suspenders: set a non-`user_cancelled`
`abortReason` (e.g. `"max_turns_reached"`) before the maxAgentTurns abort.

**TDD:** access stub with `isBackground:true`; call `abortTask()`; assert
`triggerMemoryBackgroundWriters`/`executeExtractMemories` NOT called. Second test:
foreground task still triggers writers.

---

## Branch 4 — `fix/tool-malformed-param-coercion`

**Files:** `src/core/tools/WriteToFileTool.ts`, `src/core/tools/ApplyDiffTool.ts`,
`src/core/task/subagentApproval.ts`, `src/core/memory/memorySandbox.ts`
**Tests:** `WriteToFileTool.spec.ts`, `ApplyDiffTool.spec.ts`,
`subagentApproval.spec.ts`, `memory/__tests__/memorySandbox.spec.ts`

**Bug A (weak-model params):** `WriteToFileTool.ts:31-32` reads `params.path` /
`params.content` with no type check. GLM/Qwen can emit `{"path":42,...}` or
`{"content":null}`; `path.resolve(cwd, 42)` throws a raw `TypeError`, wasting a
turn with an unhelpful error. `EditFileTool` already coerces
(`typeof x === "string" ? x : ""`). Apply the same guard; reject non-string `path`
with a clear tool error.

**Bug B (NaN start line):** `ApplyDiffTool.ts:77`
`parseInt(match(/:start_line:(\d+)/)?.[1] ?? "")` yields `NaN` when the marker is
absent. Currently harmless (multi-search-replace ignores it) but latent. Parse to
`undefined` when absent.

**Bug C (fail-safe approval):** `subagentApproval.ts:72-76` and
`memorySandbox.ts:53-57` `return "approve"` when the tool-ask JSON is unparseable —
so a malformed write bypasses the worktree/memory-dir containment check entirely.
Flip both to `return "deny"` (the sandbox's own contract says "fail-safe").
Update the existing `memorySandbox.spec.ts` assertion accordingly.

**TDD:** `execute` with `{path:42}` → clear error, no raw TypeError. `apply_diff`
without `:start_line:` → strategy receives `undefined` not `NaN`. Approval override
with `text="{invalid"` → `"deny"`.

---

## Branch 5 — `fix/cloud-share-authz` (security)

**Files:** `self-hosted-cloudapi/src/services/share_service.py`,
`self-hosted-cloudapi/src/routers/web.py`,
`self-hosted-cloudapi/src/schemas/share.py`
**Test:** `self-hosted-cloudapi/tests/test_web_and_share.py`

**Bug A:** `share_task()` never compares `task.user_id` to the caller `user_id` —
any authenticated user can share any task by id. (`delete_shared_task` already
checks ownership — the pattern was intended, missed here.) Return "Task not found"
on mismatch (don't leak existence).

**Bug B:** `/shared/{task_id}` with `visibility="organization"` only checks
`user is None` (`web.py:406`) — any logged-in user of a different org can read the
conversation. Add an org-membership / owner check.

**Bug C:** `visibility` is an unvalidated `str` and org policy
(`allow_public_task_sharing`) is enforced client-side only. Constrain to
`Literal["organization","public"]` and enforce the org setting server-side.

**TDD (pytest):** non-owner share → 404; cross-org view of org-visibility share →
404; public share when org disallows → error.

---

## Execution order

Sequential (each branch off the previous tip). After each: run that subsystem's
vitest/pytest scope green, commit with a paired note. Do NOT rebase onto main —
this whole stack lives only on the branch stack.
