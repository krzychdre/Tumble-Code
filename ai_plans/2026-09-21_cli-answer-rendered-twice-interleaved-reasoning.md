# CLI: the final answer rendered twice (interleaved reasoning leaves orphan partials)

**Date:** 2026-09-21
**Branch:** `fix/cli-duplicate-answer-after-state-replay`, stacked on
`fix/cli-tail-viewport-stale-height` (which is stacked on `main` = `ce2c52c9c`)
**Status:** implemented, unit tested, verified on the built CLI against the
reported model

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

Three facts proven, not assumed:

1. Turn 2 contains two messages that stay `partial: true` forever (`486039`
   reasoning and `486871` text). They are abandoned: the rest of the same
   reasoning block and of the same answer arrived under NEW timestamps
   (`486913`, `486935`) instead of continuing them.
2. The answer text at `486935` and the `completion_result` text at `487471` are
   byte-identical (`jq` comparison returned `true`), so the existing
   identical-text dedupe should have collapsed them and did not.
3. The restarted stream reaches the CLI as a NEW PARTIAL stream, not as one
   complete message. `ui_messages.json` keeps only the end state of each entry,
   so the file cannot show this; a trace of every delivery into
   `handleSayMessage` during a live run does (see "Live evidence" below).

## Root cause

### Why the core abandons a partial

`Task.say()` (`src/core/task/TaskAskSay.ts:550-623`) decides between "continue
the partial in place" and "append a new message" with

```ts
const lastMessage = this.access.clineMessages.at(-1)
const isUpdatingPreviousPartial =
	lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type
```

It only ever looks at the LAST message. GLM interleaves reasoning and text, so
in turn 2 the order was: reasoning partial, text partial, then more reasoning
(last message is the text partial, kinds differ, so it appends a new reasoning
stream), then the rest of the answer (last message is now reasoning, so it
appends a new text stream). Each restarted stream repeats the whole accumulated
block from the beginning and is finalized in place under its own ts, while the
abandoned partial keeps `partial: true` in `clineMessages` and is persisted that
way. Turn 1 had no interleaving, so both streams were continued in place and
nothing was abandoned. This is core-level and affects the webview too; see the
follow-up section.

### Live evidence for the restart shape

With a temporary trace of every `handleSayMessage` delivery (a live run against
the same model, four turns, 1660 deliveries), turn 1 contains:

```text
enter id=...209597 text partial=true  len=3   "Dzi"      <- stream abandoned here
enter id=...209662 text partial=true  len=9   "Dziś jest" <- NEW ts, repeats "Dzi"
enter id=...209662 text partial=true  len=50  ...         <- and keeps streaming
enter id=...209662 text partial=false len=89  ...         <- finalized in place
enter id=...210046 completion_result  len=89  ...         <- byte-identical repeat
```

That is why a fix that only recognises a COMPLETE follow-up delivery removes the
duplicate but leaves the `Dzi` fragment on screen: the follow-up arrives partial.

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

That is the reported duplicate. In turn 1 no abandoned partial sat between the
messages, nothing overwrote the marker during the replay, and the
`completion_result` was correctly suppressed.

The two secondary symptoms come from the same abandoned partials: the `Tak`
bullet is the abandoned text stream rendered as its own message, and the second
`Thinking` row is the restarted reasoning stream.

### Repro (committed, failed before the fix)

`apps/cli/src/ui/hooks/__tests__/useMessageHandlers.test.tsx`, describe block
"interleaved reasoning orphans (real task 01a0c588, 2026-09-21)": it replays the
turn the way the core delivers it, restarted streams included (a full state push
after every appended message, `messageUpdated` for in-place updates). Before the
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
`answer` (`say:text` plus `say:completion_result`) and `reasoning`. Four
changes, all inside `handleSayMessage`:

1. **Merge a restarted stream (`mergedStreamIds`).** A delivery with an unknown
   ts whose text starts with what we already rendered for that class, while that
   message is still partial, is the rest of the same stream. Its ts is mapped to
   the message that already carries the stream, and every later delivery for
   that ts (further chunks and the finalization) is routed there, so the answer
   stays one message that simply keeps growing. The prefix test is what makes
   this safe: the core re-says the whole accumulated block on every chunk, so a
   restart always repeats what came before, while a genuinely new block (for
   example a second text block after a tool call) does not.
2. **The merge only fires while the store is loading.** `getStaticCount` never
   promotes a partial message while loading, so the message being merged into is
   guaranteed to be still re-rendered. Once idle it may already be printed into
   scrollback, which ink's `<Static>` never rewrites, so an idle delivery has to
   render on its own instead of silently disappearing into a printed message.
3. **Stale partial guard.** A `partial: true` delivery for a message whose store
   copy is already complete is dropped. The core keeps the abandoned partial in
   `clineMessages` and replays it on every state push, so without this guard the
   merged message would be flipped back to partial (and to the abandoned text)
   seconds after it was completed, which also pins it in the clamped tail.
4. **Marker refresh on the seen-guard early return.** A complete delivery that
   is dropped as already rendered still records its text as the newest text of
   its class, so the marker means "the last text of this class seen in the
   array" and is stable across replays. This is what fixes the reported
   duplicate.

The older identical-text dedupe survives with unchanged semantics: it applies to
the `answer` class only, fires even when the tracked message is already
complete, and needs no loading guard because the text is identical either way
(that is the `say:text` + `say:completion_result` repetition from the
2026-08-07 plan).

Reasoning goes through the same merge, which is why the duplicated `Thinking`
row disappears as well.

## Invariants kept

- I4 from `2026-09-21_cli-answer-lost-in-dynamic-tail.md` (the ts-distinct
  identical-text dedupe): the seven original tests pass unchanged.
- I5 (a state re-push of a finalized message is a no-op): unchanged test
  "keeps a state re-push of a finalized message a no-op" still asserts object
  identity, and the new stale-partial guard only ever drops work.
- Same-ts finalization (the fix that the previous branch shipped) still takes
  precedence: `isFinalizingExisting` is computed after the merge, so a merged
  delivery finalizes the message it was merged into.
- Promotion into `<Static>` stays monotonic and printed items are never
  contradicted: the merge only rewrites a message that is still partial AND only
  while loading, which is exactly the window in which `getStaticCount` (rules 3
  and 4 in `apps/cli/src/ui/transcript.ts`) cannot have promoted it. No message
  is ever removed from the store, so `<Static>` indices never shift.
- The merge map has the lifetime of `seenMessageIds` (cleared on `/new` and on a
  task switch); the handler mirrors that reset instead of threading a second ref
  through `useTaskSubmit` and `usePickerHandlers`.

## Verification

Run from `apps/cli`:

- `npx vitest run src/ui/hooks/__tests__/useMessageHandlers.test.tsx`: 18 passed
  (14 existing, 4 new).
- `npx vitest run`: 687 passed, 1 skipped, 56 files.
- `pnpm check-types`, `pnpm lint`: clean.
- `pnpm knip` from the repo root: clean.

Manual runs on the built CLI (`apps/cli/dist/index.js`, driven under a pty at
40x150 by `pexpect` + `pyte`, same provider and model as the report:
`GLM-5.3-NVFP4` at `192.168.50.194:11111` with `--reasoning-effort high`), four
turns per run, two of them with a tool call:

- before the fix: the answer printed twice per turn plus a `Dzi` / `Tak,`
  fragment bullet and a duplicated `Thinking` row;
- after the duplicate-only fix: no duplicate, fragment still there (which is how
  the partial shape of the restart was found);
- after the merge: one `Thinking` row and one answer bullet per turn, no
  fragment, across three consecutive runs.

The instrumented run (temporary `TUMBLE_MSG_LOG` trace, removed before commit)
confirms the guards fire for the right reason: `drop-repeat` once per turn for
the `completion_result`, and `drop-stale-partial` for the abandoned `Tak` /
`Dzi` ts on every later state push, which is only possible if the merge
completed that message.

Unrelated observation from those runs, not touched here: an approved Bash call
renders two rows (the approval row `Bash(cmd)` with its output and a second
`Bash` row with the command output), which predates this branch.

## Follow-up, not done here: fix the restart at the source

`Task.say()` could look for the last message of the same say kind that is still
partial, instead of only checking `clineMessages.at(-1)`. That would stop the
abandoned partials for every consumer, the webview included (the VS Code chat
view renders the same fragment and the duplicated reasoning row).

It is deliberately out of scope here because it changes shared core behavior:
the backward search must not reach past the current turn (a partial left by an
earlier turn must never be rewritten by a later stream), so it needs a boundary
such as "stop at the last `user_feedback` or `api_req_started`" plus its own
evidence and tests. The CLI-side fix above is complete on its own and does not
depend on it: if the core stops abandoning partials, the merge simply never
fires.
