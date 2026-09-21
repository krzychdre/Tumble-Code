# CLI: the final answer rendered twice (interleaved reasoning leaves orphan partials)

**Date:** 2026-09-21
**Branch:** `fix/cli-duplicate-answer-after-state-replay`, stacked on
`fix/cli-tail-viewport-stale-height` (which is stacked on `main` = `ce2c52c9c`)
**Status:** implemented, unit tested, manual run on the built CLI still owed

Writing rule for this repo: no em dash and no en dash anywhere (code, comments,
tests, commit messages, UI strings). Use a hyphen, a comma, a colon or
parentheses.

## Problem

Reported from a live session against `GLM-5.3-NVFP4` (openai-compatible
provider at `192.168.50.194:11111`, `--reasoning-effort high`): the model's
answer is printed twice, one bullet under the other. The same screenshot shows
two more oddities in the same turn: a truncated fragment bullet (`Tak`) above
the answer, and two `.: Thinking...` rows for a single reasoning block.

```text
> to wieczor?
  .: Thinking...

* Tak
  .: Thinking...

* Tak, to wieczor - w Polsce jest teraz 21:54, czyli prawie 22:00.

* Tak, to wieczor - w Polsce jest teraz 21:54, czyli prawie 22:00.
```

The turn before it, in the same session, rendered correctly (one thinking row,
one answer), which is the clue that separates the two paths.

## Evidence

Task `01a0c588-badd-71ac-8c42-262d4ff39273`,
`~/.vscode-mock/global-storage/tasks/.../ui_messages.json`, written at 21:54 by
the run in the screenshot. Turn 1 (renders fine) versus turn 2 (renders three
bullets):

```text
turn 1
1790020468995 say reasoning          partial=false len=1147
1790020472724 say text               partial=false len=111
1790020473392 say completion_result  partial=false len=111   (byte-identical to the say:text)
1790020473427 ask completion_result  partial=false len=0

turn 2
1790020486039 say reasoning          partial=TRUE  len=259
1790020486871 say text               partial=TRUE  len=3     "Tak"
1790020486913 say reasoning          partial=false len=267   = the 259 chars + " Polish."
1790020486935 say text               partial=false len=68    the full answer
1790020487471 say completion_result  partial=false len=68    (byte-identical, verified with jq)
1790020487493 ask completion_result  partial=false len=0
```

Two facts proven from that file, not assumed:

1. Turn 2 contains two messages that stay `partial: true` forever (`486039`
   reasoning and `486871` text). They are orphans: their complete versions were
   appended under NEW timestamps (`486913`, `486935`) instead of replacing them.
2. The answer text at `486935` and the `completion_result` text at `487471` are
   byte-identical (`jq` comparison returned `true`), so the existing
   identical-text dedupe should have collapsed them and did not.

## Root cause

### Why the core leaves orphans

`Task.say()` (`src/core/task/TaskAskSay.ts:550-623`) decides between "replace
the partial in place" and "append a new message" with

```ts
const lastMessage = this.access.clineMessages.at(-1)
const isUpdatingPreviousPartial =
	lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type
```

It only ever looks at the LAST message. GLM interleaves reasoning and text, so
in turn 2 the order was: reasoning partial, text partial, then the reasoning
finalization (last message is the text partial, kinds differ, so it appends),
then the text finalization (last message is the complete reasoning, so it
appends again). Both partials are abandoned in `clineMessages` and persisted
that way. Turn 1 had no interleaving, so both finalizations hit the in-place
path and no orphan exists. This is core-level and affects the webview too; see
the follow-up section.

### Why the CLI printed the answer twice

Every new core message posts the whole state:
`TaskHistory.addToClineMessages` calls `postStateToWebviewWithoutTaskHistory()`
(`src/core/task/TaskHistory.ts:374-380`), and the CLI's `state` branch replays
the ENTIRE `clineMessages` array through `handleSayMessage`
(`apps/cli/src/ui/hooks/useMessageHandlers.ts`, the `type === "state"` branch).
So the orphan partial is re-delivered on every push for the rest of the task.

The identical-text dedupe keyed off a single pair of refs (`lastAssistantText`,
`lastAssistantId`) that were written on every delivery that fell through to
`addMessage`, and NOT written on the early return for an already seen complete
message. Replay of the array after `487471` was appended therefore ran:

| delivery                                     | what the handler did                            | marker after            |
| -------------------------------------------- | ----------------------------------------------- | ----------------------- |
| `486871` text partial "Tak"                  | falls through (partials are never seen-guarded) | `"Tak"`                 |
| `486913` reasoning complete                  | seen guard returns early                        | `"Tak"`                 |
| `486935` text complete (the answer)          | seen guard returns early, marker NOT refreshed  | `"Tak"`                 |
| `487471` completion_result (the same answer) | marker `"Tak"` != answer, so not a duplicate    | renders a SECOND bullet |

That is the reported duplicate. In turn 1 no orphan partial sat between the
messages, nothing overwrote the marker during the replay, and the
`completion_result` was correctly suppressed.

The two secondary symptoms come from the same orphans: the `Tak` bullet is the
orphan text partial rendered as its own message, and the second `Thinking` row
is the ts-distinct reasoning finalization added as a new message.

### Repro (committed, failed before the fix)

`apps/cli/src/ui/hooks/__tests__/useMessageHandlers.test.tsx`, describe block
"interleaved reasoning orphans (real task 01a0c588, 2026-09-21)": it replays the
sequence above the way the core delivers it (a full state push after every
appended message, `messageUpdated` for in-place partial updates). Before the
fix:

```text
x renders the answer once            -> ['Tak', ANSWER, ANSWER]
x renders one thinking row           -> 2 thinking rows
x leaves nothing partial             -> 2 messages still partial
x keeps deduping the completion_result after a replay -> 3 assistant bullets
```

## Fix (apps/cli/src/ui/hooks/useMessageHandlers.ts)

The single answer marker becomes one marker per stream class, where a class is
a group of say kinds the CLI renders as one continuous block:
`answer` (`say:text` plus `say:completion_result`) and `reasoning`. Three
changes, all inside `handleSayMessage`:

1. **Stale partial guard.** A `partial: true` delivery for a message whose store
   copy is already complete is dropped. The core never moves a message from
   complete back to partial, so such a delivery can only be the replay of an
   orphan, and applying it would flip the message back to partial and pin the
   rest of the session in the height-clamped dynamic tail.
2. **Marker refresh on the seen-guard early return.** A complete delivery that
   is dropped as already rendered still records its text as the newest text of
   its class. The marker now means "the last text of this class seen in the
   array", which is stable across replays.
3. **Orphan collapse (`continuesOrphan`).** A complete delivery whose text
   starts with the text of the tracked message, while that tracked message is
   still partial, is the rest of the same stream under a new ts. It is applied
   to the message already on screen and its own id is dropped. The prefix test
   is what makes this safe: the core re-says the whole accumulated block on
   every chunk, so the abandoned partial is always a prefix of the final text.
   Two genuinely different text blocks (for example narration, then a tool call,
   then a different closing sentence) are not a prefix, so they keep rendering
   as two messages.

The older identical-text dedupe survives as `repeatsLastAnswer` with unchanged
semantics: it applies to the `answer` class only and fires even when the tracked
message is already complete (that is the `say:text` + `say:completion_result`
repetition from the 2026-08-07 plan).

Reasoning now goes through the same collapse, which is why the duplicated
`Thinking` row disappears as well.

## Invariants kept

- I4 from `2026-09-21_cli-answer-lost-in-dynamic-tail.md` (the ts-distinct
  identical-text dedupe): the seven original tests pass unchanged.
- I5 (a state re-push of a finalized message is a no-op): unchanged test
  "keeps a state re-push of a finalized message a no-op" still asserts object
  identity, and the new stale-partial guard only ever drops work.
- Same-ts finalization (the fix that the previous branch shipped) still takes
  precedence: `isFinalizingExisting` short-circuits the collapse block.
- Promotion into `<Static>` stays monotonic: the collapse only rewrites a
  message while it is still partial, and a partial message is never promoted
  while the agent is loading (`getStaticCount` rules 3 and 4 in
  `apps/cli/src/ui/transcript.ts`). No message is ever removed from the store,
  so `<Static>` indices never shift.

## Verification

Run from `apps/cli`:

- `npx vitest run src/ui/hooks/__tests__/useMessageHandlers.test.tsx`: 18 passed
  (14 existing, 4 new).
- `npx vitest run`: 687 passed, 1 skipped, 56 files.
- `pnpm check-types`, `pnpm lint`: clean.
- `pnpm knip` from the repo root: clean.

Manual check still owed on a built CLI: ask a short follow-up question of a
reasoning model that interleaves reasoning and text (GLM at high reasoning
effort reproduces it within two turns) and confirm one thinking row, one answer
bullet, no fragment bullet, and that the answer lands in scrollback.

## Follow-up, not done here: fix the orphan at the source

`Task.say()` could look for the last message of the same say kind that is still
partial, instead of only checking `clineMessages.at(-1)`. That would remove the
orphans for every consumer, the webview included (the VS Code chat view renders
the same abandoned fragment and the duplicated reasoning row).

It is deliberately out of scope here because it changes shared core behavior:
the backward search must not reach past the current turn (an orphan left by an
earlier turn must never be rewritten by a later stream), so it needs a boundary
such as "stop at the last `user_feedback` or `api_req_started`" plus its own
evidence and tests. The CLI-side fix above is complete on its own and does not
depend on it: if the core stops producing orphans, `continuesOrphan` simply
never fires.
