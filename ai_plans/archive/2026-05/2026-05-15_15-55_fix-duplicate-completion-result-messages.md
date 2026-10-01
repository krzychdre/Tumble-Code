# Duplicate completion_result messages — investigation & fix

**Status:** Done (2026-05-15)
**Related plans:** `2026-05-15_10-05_fix-diffview-silent-save-failures.md`
**Touched:**

- `src/core/tools/AttemptCompletionTool.ts`
- `src/core/tools/__tests__/attemptCompletionTool.spec.ts`

## Symptom

User reported two identical "Task Completed" cards rendered back-to-back at the end of a task summary, and (separately) two identical "Roo said" text blocks. Example output:

```
API Request
Roo said
[full analysis content]

Roo said          ← duplicate, same content

API Request
Roo said
Task Completed
[summary content]

Task Completed    ← duplicate, same content
```

Reproduces "every Running, and sometimes on summary" per the user. Not bound to a specific provider (observed with a local llama.cpp OpenAI-compatible endpoint, but the user confirmed it's not a provider-side problem).

## What was happening

`attempt_completion` has two execution phases driven by the streaming pipeline:

1. **`handlePartial`** — called repeatedly while `block.partial === true`. The streamed `result` text is shown to the user incrementally.
2. **`execute`** — called once when `block.partial === false`, after the full payload is parsed. Responsible for the user approval/feedback flow.

The bug lived in the **command branch** of `handlePartial` at `AttemptCompletionTool.ts:191`:

```ts
if (command) {
	if (lastMessage && lastMessage.ask === "command") {
		await task.ask("command", command ?? "", block.partial).catch(() => {})
	} else {
		await task.say("completion_result", result ?? "", undefined, false) // ← partial=FALSE inside handlePartial
		await task.ask("command", command ?? "", block.partial).catch(() => {})
	}
}
```

The `say(..., false)` is intentional UX: when the model emits an `attempt_completion` with a `command` parameter, we want the result text visible alongside the command-approval ask while the user decides. So the result is finalized **early**, during streaming.

Then `execute()` at `AttemptCompletionTool.ts:81` did the same finalized say again, unconditionally:

```ts
task.consecutiveMistakeCount = 0
await task.say("completion_result", result, undefined, false) // ← second finalized say for the same content
```

`say(..., partial=false)` looks for a partial message of the same type at the tail of `clineMessages` and finalizes it. By the time `execute` runs, the tail is the `ask:command` from `handlePartial`, not a partial `completion_result` — so the `else` branch of `say` fires `addToClineMessages` and appends a brand-new finalized message. Two identical `say:completion_result` entries land in `clineMessages` and persist to `ui_messages.json`. Both render as "Task Completed" cards.

## Failure surface (before/after)

| Scenario                               | Before                                               | After                                 |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `attempt_completion` with no `command` | One finalized `completion_result` (correct)          | Unchanged (correct)                   |
| `attempt_completion` with `command`    | **Two** identical finalized `completion_result` says | One finalized `completion_result` say |

## Fix

`AttemptCompletionTool.ts:81-96` — `execute()` now checks whether a finalized `completion_result` with the same `text` is already in `clineMessages` before saying it again:

```ts
const alreadyFinalized = task.clineMessages?.some(
	(m) => m.type === "say" && m.say === "completion_result" && m.partial !== true && m.text === result,
)
if (!alreadyFinalized) {
	await task.say("completion_result", result, undefined, false)
}
```

The `?.` is defensive against test mocks that omit `clineMessages`. The text-equality check is exact: the `handlePartial`-emitted message used `result ?? ""`, and `execute` only runs with `result` non-empty (it returns early on missing result at line 75), so the comparison is reliable.

This preserves the existing UX (result visible during command-ask streaming) while eliminating the duplicate.

## Tests

One new regression test in `attemptCompletionTool.spec.ts` under `partial-stream / execute handoff`:

- **`does not emit a duplicate completion_result when handlePartial saw a command param`** — drives the realistic flow: two `handlePartial` invocations (first creates `say:completion_result` + partial `ask:command`; second updates the command ask), then `execute()`. Asserts exactly one finalized `completion_result` say is emitted and persisted in `clineMessages`. Failed against pre-fix code (got 2), passes after the fix (got 1).

Full `core/tools/__tests__` run: **350/350 passing**.

## Caveats — what this does NOT fix

The user's screenshot also showed two duplicate `say:text` ("Roo said") blocks in their **first** API request — a turn where no `attempt_completion` tool fired at all. This commit does not address that.

The most plausible remaining root cause is a TOCTOU race in `TaskAskSay.say()` at lines 429-446: the function reads `lastMessage`, decides to finalize a partial in place by mutating `lastMessage.partial = false` synchronously, then awaits `saveClineMessages()`. If a second `say(..., partial=false)` enters during that await, it reads the just-mutated `lastMessage` (now `partial=false`), takes the `else` branch, and `addToClineMessages` a new duplicate.

That race needs the actual `ui_messages.json` for a duplicated turn to confirm — comparing the `ts` deltas between the two messages would distinguish "model emitted the same text twice" from "Roo's say() raced with itself." Tracked as a follow-up; not in scope for this fix.
