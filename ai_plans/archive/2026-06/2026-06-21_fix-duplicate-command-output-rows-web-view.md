# Fix duplicated command-output blocks on the web task view

**Date:** 2026-06-21
**Branch:** `feature/self-hosted-remote-task-control`
**Symptom (user's words, with screenshot):** a command's output renders twice — the first
"OUTPUT" block shows only the first line and keeps a spinner (looks active forever), and a second
"OUTPUT" block below shows the full output.

---

## Root cause (proven by code trace, not assumed)

`ExecuteCommandTool` streams terminal output with `task.say("command_output", text, …, partial)`
(`src/core/tools/ExecuteCommandTool.ts:294-311`, scheduled at :313-333, finalized at :398-401).
On the **first** output line it ALSO issues `await task.ask("command_output", "")`
(`ExecuteCommandTool.ts:371`) — the "view output?" ask.

That ask is appended to `clineMessages` right after the first partial say. The next partial say then
hits `TaskAskSay.say()` where `isUpdatingPreviousPartial` requires
`clineMessages.at(-1)` to be the partial say (`TaskAskSay.ts:493-494`). It is now the **ask**, so the
check fails and a **new** partial say is created with a **new ts** (`TaskAskSay.ts:512-521`).

Net message stream for one command:

- `say command_output` **A** — ts `T1`, text = first chunk, stays `partial:true` forever (orphaned).
- `ask command_output` **B** — ts `T2`, empty text (not rendered; `classify` returns null on no text).
- `say command_output` **C** — ts `T3`, finalized full output (`partial:false`).

VS Code never shows the duplicate because the chat runs `consolidateCommands`
(`packages/core/src/message-utils/consolidateCommands.ts`): it folds every `command_output` (ask
_and_ say) into the preceding command card, dedups equal-text pairs, and drops all standalone
`command_output` rows. The web renderer `render.js` applies **no** such consolidation — it renders
each `command_output` say as its own "Output" row, keyed by its own `ts`. Two different ts (`T1`,
`T3`) → two rows; `T1` is `partial:true` → stuck spinner. Exactly the screenshot.

This is the existing-duplicate-row class noted in
`2026-06-21_fix-stuck-partial-spinners-duplicate-task-messages.md`, but those were _same-ts_ races
fixed by the unique index + history-no-animate. This case is _different-ts_ and the unique index
cannot merge it — the messages are genuinely distinct.

## Fix — bring the web renderer to parity with VS Code (frontend only)

`self-hosted-cloudapi/src/web/static/render.js`, inside `mountConversation`:

All `command_output` messages that follow one `command` represent **one logical output block**.
Collapse them onto a single row owned by the most recent command, showing the latest content — the
finalized say `C` replaces the orphaned partial `A` in place (and clears its spinner).

- Track `lastCommandTs` = ts of the most recently classified `command` message.
- Introduce `keyOf(m)`: the row-identity key (was implicitly `m.ts`). For `command_output` return
  `"cmdout@" + lastCommandTs` (fallback to own ts if no command seen yet); otherwise return `m.ts`.
  `m.ts` stays the numeric value used for step-duration math — only the dedup/DOM identity changes.
- `upsert` keys `byTs` / `rawByTs` / `activeByTs` by `key`; duration/`tail` keep numeric `ts`.
  `tail` also remembers `key` so in-place replacement of the output row is detected.
- `activeByTs[key]` becomes `{ ts, label }` so `getActivity()` can still rank by numeric recency
  even though command-output keys are non-numeric strings. `markResolved`/ask paths use real ts,
  which equals `keyOf` for asks, so they are unaffected.

Why frontend, not backend/extension: the backend stores raw `ClineMessage[]` to support live relay
and faithful replay; consolidating at storage loses fidelity and complicates streaming. The web
renderer is the direct analog of the VS Code chat view, which is exactly where consolidation lives.

## Verification

- Reload a finished task that ran a multi-line command → one OUTPUT block, full text, no spinner.
- Drive a live command → the single OUTPUT row streams (spinner) and clears on completion.
- Unrelated rows (reasoning, tools, api_req) unchanged; token/cost header unchanged.

## Out of scope

- The upstream `ExecuteCommandTool` orphaned-partial behaviour (VS Code masks it; changing it is
  broad and risky). We match VS Code's presentation instead.
