# Context Microcompaction Layer (port of Claude Code's `microcompact → autocompact`)

Date: 2026-06-07
Branch: `feat/context-microcompaction` (off `main`)

## Motivation / evidence

The user observes that Claude Code's context compaction "feels effective" while
tumble-code's does not. A comparative read of the leaked Claude Code source
(`/home/krzych/Projekty/QUB-IT/claude-code-src-leaked/services/compact/*`) vs.
this repo's `src/core/condense` + `src/core/context-management` confirms the
**root cause is architectural, not prompt quality** — tumble-code already uses
essentially Claude Code's 8-section summary prompt (`supportPrompt.default.CONDENSE`).

### What Claude Code actually does (verified by direct read)

`query.ts:396-468` runs a **staged pipeline** before every API request:

```
snip (drop oldest whole messages)
  → microcompact (clear OLD tool_result CONTENT by tool_use_id, keep last N)
  → context-collapse
  → autocompact (the expensive, lossy full LLM summarization) — LAST RESORT
```

Each cheap stage's freed-token count is subtracted before the next threshold
check, so the **full summarization usually never fires**.

- `microCompact.ts:446-530` — walks messages, keeps the last `N` (default ~5)
  tool results for a whitelist of _commodity_ tools
  (`COMPACTABLE_TOOLS`: read / grep / glob / bash / web / edit / write), and
  replaces older result content with the literal string
  `"[Old tool result content cleared]"`. **No LLM call. tool_use blocks and the
  entire dialogue are left untouched.**
- `autoCompact.ts:62-91` — token-budget threshold
  (`effectiveWindow - 13_000`), not a naive percentage.
- `autoCompact.ts:70,241-351` — a **circuit breaker**
  (`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`) stops futile summarization
  retries when context is irrecoverably oversized.

### What tumble-code does today (verified)

`context-management/index.ts:306-373` — a single binary jump: once
`contextPercent >= threshold` (or over `allowedTokens`), it immediately calls
`summarizeConversation()` which **nukes the entire conversation** into one
summary message (fresh-start model, `condense/index.ts:466-487`), with
sliding-window truncation (drop 50% oldest) as the only fallback.

**Consequence:** every minor overflow (95–105%) pays the full cost of destroying
the whole conversation + a cache-invalidating prefix rewrite + a lossy paraphrase
that becomes the model's only memory. That is exactly the "ineffective" feel.

## Decision

Port the single highest-leverage, lowest-risk mechanism: **tool-result
microcompaction as a cheap pre-pass inside `manageContext()`**, running _before_
the existing condense/truncate paths. This unifies recommendations #1
(microcompaction) and #2 (severity-graded response) from the gap analysis:
clearing old tool output first means full summarization only runs when
microcompaction did **not** free enough.

Deferred to a future stacked branch (documented, not done here):

- Recommendation #3 — keep the recent raw tail on fresh-start condense
  (touches `getEffectiveApiHistory` semantics, rewind, tool-pairing — higher risk).
- Cache-stable content replacement / read-search collapse / session memory.

## Why this is the right first port

- **No LLM call** → cannot fail or hallucinate on weak local models
  (GLM/Qwen/Llama). Strictly more reliable than condense, which it replaces in
  the common case.
- Reuses the existing data model and `getEffectiveApiHistory()` unchanged
  (it already filters orphan `tool_result` blocks by `tool_use_id`).
- Pure, deterministic, unit-testable function with a fixed placeholder.
- Degrades gracefully: if it does not free enough, the existing condense → truncate
  path still runs, on the (now smaller) history.

## Design

### New file: `src/core/context-management/microcompact.ts`

Pure function `microcompactToolResults(messages, { keepRecent })`:

1. Scope to the effective history via `getEffectiveApiHistory(messages)`.
2. Build `tool_use_id → toolName` from assistant `tool_use` blocks.
3. Collect compactable `tool_use_id`s in order — only tools in
   `COMPACTABLE_TOOL_NAMES` (read_file, read_command_output, execute_command,
   search_files, list_files, codebase_search, use_mcp_tool, access_mcp_resource,
   write_to_file, apply_diff, apply_patch, edit, edit_file, search_replace,
   search_and_replace). **Never** clears attempt_completion, ask_followup_question,
   update_todo_list, switch_mode, new_task, skill, run_slash_command,
   generate_image, tools_load — these carry irreplaceable state.
4. Keep the last `keepRecent` (default `MICROCOMPACT_KEEP_RECENT = 5`) raw; clear
   the rest by replacing `tool_result.content` with
   `MICROCOMPACT_CLEARED_PLACEHOLDER`.
5. Idempotent (skips already-cleared blocks). Returns `{ messages, clearedCount,
clearedToolUseIds, clearedText }`; `clearedText` lets the caller token-count
   the savings with one `countTokens` call.

Placeholder (explicit + actionable for weak models):
`"[Old tool output cleared to save context. Re-read the file or re-run the command if you need this output again.]"`

### Edit: `src/core/context-management/index.ts` (`manageContext`)

After `allowedTokens`/`effectiveThreshold` are computed and **before** the
condense branch, insert the pre-pass:

- If over threshold/limit, run `microcompactToolResults`.
- Estimate freed tokens (`countTokens(clearedText)`).
- If `prevContextTokens - freed` is back under both the condense threshold and
  `allowedTokens` → **return the microcompacted messages immediately** (no
  summary, no truncation: the quiet path).
- Otherwise thread the microcompacted `workingMessages` into the existing
  condense and truncate calls (smaller input → cheaper summary).

New optional fields on `ContextManagementResult`: `microcompacted?`,
`microcompactClearedCount?`, `microcompactTokensCleared?` (telemetry/UI only;
caller needs no changes — empty `summary`/`truncationId` ⇒ silent).

### Tests: `src/core/context-management/__tests__/microcompact.spec.ts`

- keeps last N raw, clears older compactable results;
- never clears non-compactable tools / recent tail / already-cleared blocks;
- respects effective-history scoping (ignores condensed-away messages);
- `manageContext` integration: microcompaction-only path (no condense),
  and escalation path (microcompact + condense when not enough).

## Known limitations (documented tradeoffs)

- **Destructive-but-recoverable**: like Claude Code's time-based microcompact,
  this mutates stored `tool_result.content`. A rewind to a point before an old
  cleared result will show the placeholder, not the original output. The data is
  re-derivable (the placeholder says how). Only _old_ results (beyond the recent
  N) are ever cleared, so realistic recent rewind targets are unaffected. A fully
  non-destructive variant (store-original + send-time transform) is possible but
  is a much larger change — deferred.
- Only affects native `tool_use`/`tool_result` block histories (the path this
  fork uses). Classic XML-text tool output, if present, is a no-op (safe;
  condense still handles it).
