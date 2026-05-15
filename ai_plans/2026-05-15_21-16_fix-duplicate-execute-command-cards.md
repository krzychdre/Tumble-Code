# Duplicate `ask` cards on tool approval — investigation & fix

**Status:** Done (2026-05-15)
**Related plans:** `2026-05-15_15-55_fix-duplicate-completion-result-messages.md`
**Touched:**

- `src/core/task/TaskAskSay.ts`
- `src/core/task/__tests__/ask-finalized-dedup.spec.ts` (new)

## Symptom

User initially reported that every `execute_command` rendered **two** command cards in the chat:

1. The **first** card showed the command text and the approval prompt, then went silent. No PID. No green/red status ball. No streaming output.
2. The **second** card appeared right after approval, showing the same command text, but this one received the `commandExecutionStatus` updates: PID while running, green/red ball at exit.

Then the user observed the same shape on `codebase_search`:

```text
Roo wants to search the codebase for graphql requests query get package by instrument serial number metadata in lids/c6800/tests/integration

Roo wants to search the codebase for graphql requests query get package by instrument serial number metadata in lids/c6800/tests/integration
```

Confirmed via the affected task's `ui_messages.json`. Two `ask:command` entries 216 ms apart with the same text:

```json
{ "ts": 1778860133395, "type": "ask", "ask": "command", "partial": false, "text": "cd … && uv build --wheel" }
{ "ts": 1778860133611, "type": "ask", "ask": "command", "partial": null,  "text": "cd … && uv build --wheel" }
```

The fingerprint matters:

- The first entry has `partial: false` — it was a partial that got finalized in place.
- The second has `partial` **missing entirely** — fingerprint of the "new and complete message" branch in `TaskAskSay.ask()` (lines 137–151), which builds the message object without a `partial` field.

## What was happening

Every `askApproval`-using tool has two streaming phases:

1. **`handlePartial`** — called repeatedly while `block.partial === true`. It runs `task.ask(type, text, true)`, which either creates a new partial ask at the tail of `clineMessages` or updates the existing one.
2. **`execute`** — called once when `block.partial === false`. It calls `askApproval(type, text)`, which internally invokes `cline.askSay.ask(type, text, false)` (see `presentAssistantMessage.ts:500-506`).

The UI half is rendered through components keyed on `message.ts`. For `execute_command`, [`CommandExecution.tsx`](../webview-ui/src/components/chat/CommandExecution.tsx) matches `commandExecutionStatus` events by `executionId === message.ts.toString()` (line 122). On the extension side, `executionId = task.lastMessageTs?.toString()` (`ExecuteCommandTool.ts:74`). When everything lines up, **one** message morphs in place: pre-approval → started (PID) → exited (status ball).

The bug: by the time `askApproval`'s `ask(type, text, false)` runs, the tail of `clineMessages` is sometimes already a **finalized** ask of the same type with the same text — not the partial one `handlePartial` created. `TaskAskSay.ask()`'s in-place update branch required `lastMessage.partial === true`:

```ts
const isUpdatingPreviousPartial =
	lastMessage && lastMessage.partial && lastMessage.type === "ask" && lastMessage.ask === type
```

With `lastMessage.partial === false`, `isUpdatingPreviousPartial` is `false` and the `else` branch at lines 137–151 fired, calling `addToClineMessages` with a brand-new `ts`. A second ask was appended.

Consequences:

- For `execute_command`: the old card (`ts=T1`) renders via `CommandExecution` with `executionId = T1`. Status events arrive with `executionId = task.lastMessageTs = T2` (the new ts). They never match T1 — the old card stays frozen at the approval state. The new card (`ts=T2`) gets the PID and status ball.
- For `codebase_search` / `read_file` / `apply_diff` / `list_files` etc.: every `askApproval`-using tool that calls `ask("tool", ...)` is affected. Two visually identical approval cards appear back-to-back.

The upstream race that finalizes the partial before `askApproval` runs is not fully nailed down — the 216 ms gap and the surrounding `say:text "\n\n"` 37 ms before the first ask suggest a re-entry through `presentAssistantMessage`'s `pendingUpdates` mechanism interacting with the partial→non-partial transition in `TaskStreamProcessor`'s `tool_call_end` handler. The fix below is at the deduplication boundary, not the race itself.

## Failure surface (before/after)

| Scenario                                                                | Before                                                   | After                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| `execute_command` (any model, every invocation)                         | **Two** `ask:command` cards; only second gets PID/status | **One** card, full lifecycle in place |
| `codebase_search` / `read_file` / `apply_diff` / `list_files` / ...     | **Two** identical `ask:tool` cards                       | **One** card                          |
| Legitimate distinct asks (different text or different type at the tail) | Unchanged (each appends)                                 | Unchanged (each appends)              |
| Partial → finalize handoff (the originally intended in-place update)    | Unchanged                                                | Unchanged                             |

## Fix

`TaskAskSay.ts:110-152` — in the `partial === false` branch, broaden the in-place update rule to also treat an **already-finalized matching tail** as the message to reuse:

```ts
const isAlreadyFinalizedDuplicate =
	!!lastMessage &&
	lastMessage.partial !== true &&
	lastMessage.type === "ask" &&
	lastMessage.ask === type &&
	(lastMessage.text ?? "") === (text ?? "")

if (isUpdatingPreviousPartial || isAlreadyFinalizedDuplicate) {
	// existing in-place finalize logic — reuses lastMessage.ts, resets askResponse,
	// updates fields, saves, posts.
}
```

Both predicates fall through the same in-place branch — it reuses `lastMessage.ts` (so `lastMessageTs` stays stable, so executionId routing keeps working), resets `askResponse` (so `pWaitFor` waits for the new response), and re-runs save/update.

The dedup is conservative — it only collapses calls where the tail is the **same ask type with the same text**. Different text or different ask type still appends, so legitimate consecutive asks are unaffected.

This is the root-cause fix for **every** `askApproval`-using tool — `execute_command`, `codebase_search`, `read_file`, `apply_diff`, `list_files`, `write_to_file`, `use_mcp_tool`, etc.

## Tests

New file `src/core/task/__tests__/ask-finalized-dedup.spec.ts`, 5 tests under `TaskAskSay.ask — finalized-duplicate dedup`:

1. **`does not append a second ask:command when the tail is already a matching finalized ask:command`** — seeds the bug-state tail (`partial: false`, same text), calls `task.ask("command", text, false)`, asserts exactly one `ask:command` remains and `lastMessageTs` matches the seeded `ts`.
2. **`dedups ask:tool (covers codebase_search / read_file / apply_diff / etc.)`** — same shape with the shared `"tool"` ask type and a `codebaseSearch` JSON payload.
3. **`still appends when the tail has a different text`** — guards against over-eager dedup (legit distinct asks must still append).
4. **`still appends when the tail has a different ask type`** — same, type-side.
5. **`finalizes a partial tail in place (existing behavior preserved)`** — regression guard for the original `isUpdatingPreviousPartial` path.

Verified: with the new `isAlreadyFinalizedDuplicate` disjunct removed from the `if`, tests 1 and 2 fail (got 2, expected 1) and tests 3–5 pass — confirming the tests catch the bug without false positives. With the fix restored, all 5 pass.

Cross-suite regression: `ask-finalized-dedup.spec.ts` (5) + `ask-queued-message-drain.spec.ts` (2) + `executeCommandTool.spec.ts` (13) + `attemptCompletionTool.spec.ts` (14) — **34/34 passing**.

## Notes

- The per-tool guard initially added to `ExecuteCommandTool.execute()` was removed once the root-cause fix landed in `TaskAskSay.ask()`. The single fix in `TaskAskSay` is the authoritative location.
- The upstream race that produces the duplicate `ask(text, false)` call (or finalizes the partial before `askApproval` runs) is still not pinned down. The dedup makes that race inert from the user's perspective; pinning it down is a follow-up, not a regression risk.
