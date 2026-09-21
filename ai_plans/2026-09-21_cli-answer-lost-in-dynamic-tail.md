# CLI: final answer lost in the dynamic tail (never promoted to scrollback)

**Date:** 2026-09-21
**Branch:** `fix/cli-answer-lost-in-dynamic-tail` (forked from `rescue/cli-installed-build` = `f6ed54afd`; NOT based on `main`)
**Worktree:** `/tmp/tumble-cli-fix` (CLI in `apps/cli`, `node_modules` symlinked from the main tree)
**Status:** planned, not implemented

Writing and coding rule for every implementer of this plan: never use an em dash
or an en dash anywhere (code, comments, tests, commit messages, UI strings). Use a
hyphen, a comma, a colon or parentheses. Existing files still contain em dashes in
old comments; do not add new ones and do not rewrite old ones outside the lines
you touch.

## Problem

At the end of a long session the CLI's final answer shows as a few lines under a
dim `… +38 lines` marker, and nothing the user can do reveals the hidden text.
Tool results earlier in the transcript are readable, the answer itself is not.
In the user's words: "the whole answer is collapsed somewhere and inaccessible to
the user; that defeats the whole point of the work."

Two secondary complaints are in scope as well: capped tool-output previews
(`… +N lines` under Bash/Read/Search rows) have no expand affordance, and the
model's reasoning is rendered as a bare `∴ Thinking…` with the text dropped
entirely.

## Root cause (proven)

### Architecture recap

The transcript is split in two (`apps/cli/src/ui/App.tsx:257-299`, `492-514`):

- a `<Static>` region: promoted messages, printed once into native terminal
  scrollback at full height, never re-rendered (`App.tsx:492-504`);
- a dynamic tail: everything after the promoted prefix, re-rendered every frame
  and height-clamped twice: per message by `DynamicTailMessage`
  (`apps/cli/src/ui/components/DynamicTailMessage.tsx:29-51`, budget
  `max(3, floor((rows - 12) / dynamicCount))` rows from `App.tsx:295-299`,
  keeping the TAIL of the text and printing `… +N lines` above it), and as a
  whole by `TailViewport` (`apps/cli/src/ui/components/TailViewport.tsx:37-52`,
  hard cap `rows - 2`, bottom anchored, clips the oldest rows).

The promotion rule is `getStaticCount` (`apps/cli/src/ui/transcript.ts:20-28`):
hold back the trailing message while loading or while an ask is pending, and
never promote anything from the first message with `partial === true` onward.
`App.tsx:289` makes the promoted count monotonic (`prevStaticCount`).

So a message reaches scrollback in full only if it ever becomes `partial: false`
in the store.

### The bug

The core streams an assistant answer as many `say:text` updates with ONE ts and
`partial: true`, then finalizes it with the SAME ts and `partial: false`:

- `src/core/task/TaskAskSay.ts:551-561`: partial update of the last message in
  place (same ts), posted through `updateClineMessage`;
- `src/core/task/TaskAskSay.ts:585-600`: the complete version replaces the
  partial in place (`lastMessage.partial = false`, same ts) and is posted
  through `updateClineMessage`;
- `src/core/task/TaskHistory.ts:430-442`: `updateClineMessage` posts
  `{ type: "messageUpdated", clineMessage }` to the CLI.

The CLI handler swallows that finalization:

- `apps/cli/src/ui/hooks/useMessageHandlers.ts:101-103`:
  `if (seenMessageIds.current.has(messageId) && !partial) return`. The first
  partial already added the id at `useMessageHandlers.ts:140`, so the final
  delivery (same id, `partial === false`) returns here.
- `apps/cli/src/ui/hooks/useMessageHandlers.ts:134-138`: even without the guard
  above, the identical-text dedupe would drop it, because
  `lastAssistantText.current` was set to the same text by the last partial
  (`useMessageHandlers.ts:145-147`).

Consequence: the store copy keeps `partial: true` forever
(`apps/cli/src/ui/store.ts:171-213` only ever writes `partial: true` on the
debounced path; the replace-in-place path at `store.ts:215-221` is never
reached). `getStaticCount` returns an index at or below that message forever,
the message never enters `<Static>`, and it renders only through
`DynamicTailMessage` (tail-clamped) and `TailViewport` (top-clipped). The user
sees the last few lines and a `… +38 lines` marker with no way to reach the rest.

The same guard swallows the reasoning finalization. The core finalizes
`say:reasoning` out of order (`src/core/task/TaskStreamProcessor.ts:563-575`:
finds the last reasoning message, sets `partial = false`, posts
`updateClineMessage`), so every thinking message is also stuck `partial: true`
and blocks promotion of everything after it.

### Repro (already run on this branch, failing)

`apps/cli/src/ui/hooks/__tests__/repro-finalization.test.tsx` (untracked) feeds
the exact sequence through `handleExtensionMessage`: echo (ts 1, swallowed as
the prompt echo), three partials with ts 2, one final with ts 2.

```text
$ cd /tmp/tumble-cli-fix/apps/cli && npx vitest run src/ui/hooks/__tests__/repro-finalization.test.tsx
MESSAGES: [{"id":"2","partial":true}]
staticCount(idle): 0 of 1
AssertionError: expected true to be false   (messages[0].partial)
```

### Why the guard exists (must keep working)

Commit `0436eca8a` ("dedupe duplicate assistant responses with identical text")
and `765959348` ("collapse completion_result repeating the streamed answer")
protect against a real core behavior: two ClineMessages with identical text and
DIFFERENT ts. Mechanism, visible in `TaskAskSay.ts:551-552`: the in-place
finalization only happens when the partial is still the LAST message. If a
reasoning or grounding message was appended after the text partial, the
finalization is added as a NEW complete message with a new ts, and the old
partial stays `partial: true` in the core too. GLM additionally repeats the
whole answer inside `attempt_completion.result`, which yields `say:text` then
`say:completion_result` with byte-identical text and distinct ts.

Tests covering that in `apps/cli/src/ui/hooks/__tests__/useMessageHandlers.test.tsx`
(lines 118-229) must keep passing. The fix therefore has to distinguish
"same ts, finalizing an existing partial message" (apply it) from
"different ts, duplicate text" (suppress it, and, new in this plan, treat the
duplicate as the finalization of the earlier partial).

### Why the clamps exist (must keep working)

Commits `35abe1507` and `e84909c04` (plan
`ai_plans/2026-08-07_cli-clamp-dynamic-tail-height.md`): ink can only erase rows
inside the visible viewport. If the dynamic region grows to the terminal height,
rows scroll into scrollback where they can never be erased (permanent
duplicates), and at `lastOutputHeight >= rows` ink switches to
`clearTerminal + fullStaticOutput + output` every frame
(`apps/cli/node_modules/ink/build/ink.js:180-186`, ink pinned at 6.6.0). Promoted
text is safe precisely because `<Static>` output is written once into scrollback
(`ink.js:187-191`) and never re-rendered.

## Invariants (explicit, an implementer must not break these)

- I1. The dynamic tail (all children of `TailViewport`) stays strictly under the
  terminal height. `TailViewport maxRows = rows - 2` and the per-message
  `DynamicTailMessage` clamp stay in place. No code path may render an
  unclamped message body, an expanded tool preview, or a reasoning body inside
  the tail. `DynamicTailMessage` never passes `expanded` to `ChatHistoryItem`.
- I2. `<Static>` items print once. Nothing that must be readable in full may
  rely on a re-render of an already printed item. Changing what an item shows
  after it was printed requires printing a new item (or remounting `<Static>`
  through its `key`).
- I3. Promotion is monotonic (`prevStaticCount` in `App.tsx:284-289`); a
  message that was promoted is never pulled back into the tail. Remounting
  `<Static>` happens only through a `key` change.
- I4. The ts-distinct identical-text dedupe stays: the seven tests at
  `useMessageHandlers.test.tsx:118-229` pass unchanged.
- I5. A `state` push re-delivering an already finalized message (same ts,
  `partial: false`, store copy not partial) stays a no-op. Every state push
  replays the whole `clineMessages` array through `handleSayMessage`
  (`useMessageHandlers.ts:358-374`), so a naive "always apply the final
  delivery" would replace every message on every push.
- I6. No raw writes to stdout outside ink (addendum 2 of the clamp plan).
- I7. `ink` stays pinned at exactly `6.6.0` in `apps/cli/package.json`.
- I8. Thinking content is shown only in `<Static>` (never in the tail) and only
  when the user asked for it (verbose mode, slice 4).

## Work slices

Slices 1, 2 and 3 are independent and may run in parallel (they touch disjoint
files; each has its own test files). Slice 4 depends on slice 3 (it consumes the
`expanded` prop) and must be sequenced after slice 2 (both edit
`apps/cli/src/ui/transcript.ts` and its test). Slice 5 runs last.

All commands below assume `cd /tmp/tumble-cli-fix/apps/cli` first (the Bash tool
resets its working directory between calls).

### Slice 1: apply same-ts finalization, keep the ts-distinct dedupe (root-cause fix)

Files:
- `apps/cli/src/ui/hooks/useMessageHandlers.ts`
- `apps/cli/src/ui/hooks/__tests__/useMessageHandlers.test.tsx` (extend)
- delete the untracked `apps/cli/src/ui/hooks/__tests__/repro-finalization.test.tsx`
  after its scenario is moved into the test file above.

Change, in `handleSayMessage`:

1. Before the seen-guard, look up the store copy:
   `const existing = useCLIStore.getState().messages.find((m) => m.id === messageId)`
   and compute `const isFinalizingExisting = !partial && existing?.partial === true`.
   The store is synchronous and a NEW message is applied immediately
   (`store.ts:164-167`), so during streaming the copy always exists with
   `partial: true`, even while later partials sit in the 150 ms debounce queue.
2. Seen-guard becomes: `if (seenMessageIds.current.has(messageId) && !partial && !isFinalizingExisting) return`.
   This keeps I5: a re-pushed message whose store copy is already final is
   still dropped.
3. Identical-text dedupe becomes conditional on `!isFinalizingExisting`. When it
   DOES fire (ts-distinct duplicate), additionally finalize the earlier partial:
   keep a new ref `lastAssistantId` next to `lastAssistantText`; if the store
   copy for `lastAssistantId` is still `partial: true`, call
   `useCLIStore.getState().updateMessage(lastAssistantId, text, false)`. This is
   justified by `TaskAskSay.ts:551-552`: the ts-distinct duplicate IS the
   finalization the core could not apply in place. Reset `lastAssistantId`
   together with `lastAssistantText` at `user_feedback`.
4. The finalizing delivery falls through to `addMessage(...)` with
   `partial: false`; `store.ts:215-221` replaces the message in place and clears
   the pending debounce entry. Thinking (`say === "reasoning"`) takes the same
   path, so reasoning finalization from `TaskStreamProcessor.ts:563-575` now
   lands too.

What could break:
- I4 (identical-text dedupe): guarded by the existing tests and by the new
  "still suppressed" test below.
- I5 (state re-push): guarded by a new test that pushes the same finalized
  message twice through `type: "state"` and asserts a single, unchanged store
  entry.
- The prompt-echo skip (`useMessageHandlers.ts:95-99`) runs before the new
  lookup and is unaffected.
- `updateMessage` is an existing store action (`store.ts:224-247`), no new API.

Tests to add in `useMessageHandlers.test.tsx` (each one names the scenario in
`it(...)`):
- "applies the same-ts finalization of a streamed say:text" (the repro: after
  the 250 ms wait, `messages.length === 1`, `partial === false`,
  `getStaticCount(messages, false, false) === 1`);
- "applies the same-ts finalization of say:reasoning" (thinking message ends
  `partial: false`, content is the final reasoning text);
- "still suppresses a ts-distinct identical-text duplicate" (ts 1000 partial
  "Hello there", ts 1001 final "Hello there": one assistant message) and, in
  the same test, "and finalizes the earlier partial in place"
  (`messages[0].partial === false`);
- "keeps a state re-push of a finalized message a no-op" (I5);
- "does not finalize across say kinds with different text" (text partial then
  a different completion_result: two messages, the first still partial until
  its own finalization arrives).

Verification:
- `npx vitest run src/ui/hooks/__tests__/useMessageHandlers.test.tsx`
- `npx vitest run src/ui/__tests__/transcript.test.ts src/ui/__tests__/store.test.ts`
- `pnpm check-types && pnpm lint`

### Slice 2: idle safety net in the promotion rule (defense in depth)

Files:
- `apps/cli/src/ui/transcript.ts`
- `apps/cli/src/ui/store.ts`
- `apps/cli/src/ui/__tests__/transcript.test.ts`
- `apps/cli/src/ui/__tests__/store.test.ts`

Change:

1. `getStaticCount`: when `!isLoading && !hasPendingAsk` (the agent is idle and
   no message can receive further updates), ignore the `partial` flags and
   promote everything. Justification: a partial message that never received its
   finalization (task cancelled with Escape mid-stream, a resumed task whose
   history contains an aborted partial, or any future core path that appends a
   new message instead of finalizing) would otherwise pin the whole rest of the
   session in the clamped tail. The "first partial" rule stays in force while
   loading or while an ask is pending. Update the doc comment (rules 1-4).
2. `store.ts`: export `flushPendingStreamUpdates()` that synchronously applies
   the debounced partial queue (`pendingStreamUpdates`) and clears the timer,
   and call it inside `setLoading` when `loading === false`. Without this, a
   partial chunk queued within the last 150 ms before `completion_result`
   could be applied AFTER the idle promotion printed the message, so scrollback
   would hold text missing the last chunk (I2: printed items never update).

What could break:
- The `isLoading` flag must really mean "no further stream updates". Sites that
  clear it: `useMessageHandlers.ts:190` (resume asks) and `:202`
  (completion_result); the implementer greps `setLoading(false)` across
  `apps/cli/src` and confirms each site is a stream boundary.
- `transcript.test.ts:35-58` encode the first-partial rule with
  `isLoading === false`; rewrite those cases to pass `isLoading: true` (or a
  pending ask) so they keep testing the streaming rule, and add idle cases.

Tests:
- `transcript.test.ts`: "promotes a stuck partial when idle", "keeps the
  first-partial clamp while loading", "keeps the first-partial clamp while an
  ask is pending".
- `store.test.ts`: "setLoading(false) flushes queued partial updates
  synchronously" (queue a partial for an existing message, call
  `setLoading(false)`, assert the content is applied without waiting).

Verification:
- `npx vitest run src/ui/__tests__/transcript.test.ts src/ui/__tests__/store.test.ts`
- `pnpm check-types && pnpm lint`

### Slice 3: `expanded` rendering mode for tool previews and thinking (pure rendering, no behavior change by default)

Files:
- `apps/cli/src/ui/components/ChatHistoryItem.tsx` (new optional prop `expanded?: boolean`, default false, forwarded)
- `apps/cli/src/ui/components/tools/types.ts` (`ToolRendererProps.expanded?: boolean`)
- `apps/cli/src/ui/components/primitives/ResultRow.tsx` (accept `maxLines={Number.POSITIVE_INFINITY}`; `slice(0, Infinity)` already works, only the types and the doc comment change)
- `apps/cli/src/ui/components/tools/CommandTool.tsx` (`MAX_OUTPUT_LINES` 10 lifted when expanded)
- `apps/cli/src/ui/components/tools/GenericTool.tsx` (`MAX_CONTENT_LINES` 12)
- `apps/cli/src/ui/components/tools/SearchTool.tsx` (`MAX_RESULT_LINES` 15, both the per-line list and the raw fallback)
- `apps/cli/src/ui/components/tools/FileWriteTool.tsx` (`MAX_HUNKS` 2, `MAX_HUNK_LINES` 8, batch list)
- `apps/cli/src/ui/components/tools/FileReadTool.tsx` (`MAX_BATCH_FILES` 10 and `MAX_PREVIEW_LINES` 12; note the single-file branch usually shows "Read N lines" because the CLI never receives the file body, so expanded mode changes little there)
- `apps/cli/src/ui/components/messages/ThinkingMessage.tsx` (new props `content?: string`, `expanded?: boolean`)
- `apps/cli/src/ui/components/tools/ModeTool.tsx` and `CompletionTool.tsx`: no cap to lift, no change.

Change:
- Each capped renderer computes its limit as `expanded ? Number.POSITIVE_INFINITY : MAX_...`.
- `ThinkingMessage`: collapsed (default) renders exactly today's one-liner
  `∴ Thinking…`. Expanded with non-empty content renders the header
  `∴ Thinking` and the sanitized reasoning body below it, dim italic, indented
  two columns under the header, plain `Text` with `wrap="wrap"` (no Markdown:
  reasoning is free text and Markdown would eat asterisks). Expanded with empty
  content renders the collapsed one-liner.
- `ChatHistoryItem` passes `content={message.content}` and `expanded` to
  `ThinkingMessage`, and `expanded` to every tool renderer.
- `DynamicTailMessage` is NOT touched in this slice and must never pass
  `expanded` (I1, I8).

What could break:
- Snapshot-style tests in `apps/cli/src/ui/components/tools/__tests__/*.test.tsx`
  and `apps/cli/src/ui/components/__tests__/ChatHistoryItem.test.tsx` and
  `DynamicTailMessage.test.tsx` compare frames; the default rendering must be
  byte-identical to today, which the third `DynamicTailMessage` test ("does
  not clamp tool messages") enforces indirectly.

Tests:
- `tools/__tests__/CommandTool.test.tsx`: "shows all output lines when expanded"
  (30 lines, expect no `+20 lines`, expect line 29 present), and "caps at 10
  by default".
- new `apps/cli/src/ui/components/messages/__tests__/ThinkingMessage.test.tsx`:
  collapsed hides content; expanded shows content; expanded with empty content
  falls back to the one-liner.
- `components/__tests__/ChatHistoryItem.test.tsx`: thinking role forwards
  `content` and `expanded`; tool role forwards `expanded`.

Verification:
- `npx vitest run src/ui/components`
- `pnpm check-types && pnpm lint`

### Slice 4: ctrl+o verbose toggle, printed into scrollback (depends on slice 3, after slice 2)

Files:
- `apps/cli/src/lib/utils/input.ts` (register `ctrl-o`, including the CSI u form
  `\x1b[111;5u`, 111 = "o", mirroring the `ctrl-t` entry at `input.ts:58-70`)
- `apps/cli/src/lib/utils/__tests__/input.test.ts`
- `apps/cli/src/ui/stores/uiStateStore.ts` (`verboseTranscript: boolean`,
  `transcriptReprintEpoch: number`, `toggleVerboseTranscript()`)
- `apps/cli/src/ui/hooks/useGlobalInput.ts` (handle `ctrl-o`: toggle, close the
  picker if open, toast via `showInfo`)
- `apps/cli/src/ui/transcript.ts` (new pure `buildStaticItems(...)`, see below)
- `apps/cli/src/ui/__tests__/transcript.test.ts`
- `apps/cli/src/ui/App.tsx` (use `buildStaticItems`, key `<Static>` on
  `${staticKey}:${transcriptReprintEpoch}`, pass `expanded` into the `<Static>`
  render callback, render the divider item)
- `apps/cli/src/ui/components/DynamicTailMessage.tsx` (marker text) and
  `apps/cli/src/ui/components/__tests__/DynamicTailMessage.test.tsx`
- `apps/cli/src/ui/components/autocomplete/triggers/HelpTrigger.tsx` (entry
  `{ key: "verbose", shortcut: "ctrl + o", description: "to expand tool output and thinking" }`)
  and its test `triggers/__tests__/HelpTrigger.test.tsx`
- `MultilineTextInput` needs no change: it already ignores every registered
  global sequence (`apps/cli/src/ui/components/MultilineTextInput.tsx:247-249`).

Behavior:
- ctrl+o flips `verboseTranscript`. Turning it ON also increments
  `transcriptReprintEpoch`, which changes the `<Static>` key. Remounting
  `<Static>` resets its internal index to 0 (`node_modules/ink/build/components/Static.js`,
  `useState(0)` plus `useLayoutEffect` on `items.length`), so every current
  item is printed again, this time with `expanded: true`. The reprint starts
  with a synthetic divider item (`id: "__divider__:<epoch>"`, one dim line such
  as `── expanded transcript (ctrl+o to collapse) ──` built from hyphens or
  `figures`, no dash characters other than `-`) and omits the welcome banner.
  While ON, every later promotion prints expanded as well.
- Turning it OFF does not reprint anything (nothing new to show); later
  promotions print collapsed again; a toast says "Collapsed view".
- The dynamic tail is unchanged in both modes (I1). The `DynamicTailMessage`
  marker becomes `… +N lines (prints in full when this message completes)`.
  The existing assertion `toContain("+25 lines")` keeps passing; add an
  assertion on the suffix.
- `buildStaticItems({ messages, welcomeProps, expanded, reprintEpoch })` returns
  `[welcome, ...messages]` for epoch 0 and `[divider(epoch), ...messages]` for
  epoch > 0, each message item carrying `expanded`. `App.tsx:319-325` is
  replaced by a `useMemo` over that function.

Design decision (see the decision section below): ctrl+o prints the expanded
content into scrollback through `<Static>`; it never expands anything inside
the dynamic tail.

What could break:
- I3: the reprint key change also resets nothing else; `prevStaticCount`,
  `prevIdsRef` and the task-switch effect (`App.tsx:274-287`) are untouched,
  and `staticMessages` is the same slice, so the reprint is exactly the
  promoted prefix.
- Terminal interception of ctrl+o: verify manually in GNOME Terminal and in the
  VS Code integrated terminal (VS Code binds ctrl+o to "open file" at the
  workbench level; it is not in the default `commandsToSkipShell` list, so the
  key should reach the shell, but this must be observed, not assumed). If it
  is intercepted somewhere, document it in the help entry rather than adding a
  second binding in this plan.
- A very long session reprints the whole promoted transcript in one static
  write. That is the same write path as promoting one long message
  (`ink.js:187-191`) and happens once per ON toggle, so it is bounded by user
  action.

Tests:
- `input.test.ts`: `ctrl-o` matches `key.ctrl && input === "o"` and the CSI u
  form; `isGlobalInputSequence` returns it (so the text input ignores it).
- `transcript.test.ts`: `buildStaticItems` for epoch 0 (welcome first, no
  divider), epoch 1 (divider first, no welcome, every item `expanded: true`),
  epoch 1 with `expanded: false` after toggling off (divider still present for
  that epoch, items collapsed).
- `HelpTrigger.test.tsx`: the new entry is listed and filterable by "expand".
- `DynamicTailMessage.test.tsx`: marker suffix present.
- A store test for `toggleVerboseTranscript` (ON increments the epoch, OFF does
  not) in a new `apps/cli/src/ui/stores/__tests__/uiStateStore.test.ts`.

Verification:
- `npx vitest run src/lib/utils/__tests__/input.test.ts src/ui/__tests__/transcript.test.ts src/ui/components/__tests__/DynamicTailMessage.test.tsx src/ui/components/autocomplete/triggers/__tests__/HelpTrigger.test.tsx`
- `pnpm check-types && pnpm lint`
- Manual PTY check (slice 5).

### Slice 5: full gates and manual verification (last)

Commands, from `/tmp/tumble-cli-fix/apps/cli`:
- `pnpm test` (all), `pnpm check-types`, `pnpm lint`
- from `/tmp/tumble-cli-fix`: `pnpm knip` must exit 0 (new exports such as
  `buildStaticItems` and `flushPendingStreamUpdates` must have importers).
- `pnpm build` in `apps/cli`, then run the built CLI in a 24-row terminal
  against a provider that streams long answers (GLM via Z.ai reproduces the
  duplicate-text path best). Check, in this order:
  1. a long final answer is printed in full into scrollback once the task
     completes (scroll up: the whole answer is there, no `… +N lines` marker
     remains for it);
  2. no duplicated rows appear anywhere (spinner, prompt, dialog options),
     which would indicate I1 is broken;
  3. a `Thinking` row followed by a long answer promotes both (the reasoning
     finalization path);
  4. ctrl+o prints the divider and the expanded transcript: Bash output
     uncapped, `∴ Thinking` with the reasoning body; ctrl+o again shows the
     "Collapsed view" toast; a later tool call prints collapsed;
  5. Escape mid-stream, then a new prompt: the aborted partial gets promoted
     when the agent is idle (slice 2) and the session keeps promoting.
- Commit each finished slice immediately (the user rebuilds and tests mid
  session; uncommitted edits have been lost before).

## Decision: how ctrl+o "expands"

Chosen: ctrl+o is a session-wide verbose toggle whose expanded content is
printed into scrollback through `<Static>` (a reprint of the promoted
transcript on toggle ON, expanded rendering for all later promotions). The
dynamic tail keeps its clamps in both modes.

Rejected alternative A: expand in place inside the dynamic tail (remove the
`… +N lines` clamp, or raise the row budget, while a message is expanded). This
violates I1 by construction: a 38-line answer cannot be shown unclamped in a
24-row terminal without the tail reaching the terminal height, which is exactly
the condition that produced permanent duplicated rows and the clearTerminal
fallback (`ink.js:180-186`). Any "expanded" tail would have to be clamped again,
so it cannot deliver the hidden text. After slice 1 the tail marker only ever
appears on messages that are still streaming, and those are printed in full
seconds later by promotion; an expand affordance there would buy nothing.

Rejected alternative B: per-item expansion (select one collapsed row, print
only that row's full body as a new static item). Cheaper output, but it needs a
selection model (which item, how to navigate) that the Static-scrollback
architecture does not have (there is no in-app scroll viewport since the
`<Static>` redesign; see `useGlobalInput.ts:32-34`), and an out-of-context
single body printed at the bottom is harder to read than the same transcript
reprinted with everything opened. Claude Code's ctrl+o semantics (a global
verbose toggle) are also what the user asked for "in the spirit of".

Residual known gap, out of scope: while an approval or followup dialog is up,
`getStaticCount` holds back the message just before it (rule 2 in
`transcript.ts`), so a long answer immediately preceding an ask stays clamped
in the tail until the ask resolves; it is then promoted and printed in full.

## Appendix: follow-up plan sketch, returning the CLI stack to `main`

Not part of this work. Do NOT rebase in this branch.

Facts (measured 2026-09-21):
- merge-base `main`..`HEAD` = `8f8550ccb`.
- this branch is 38 commits ahead of the merge-base; `main` is 24 commits ahead
  of it (`61be588a7` at the top).
- `main` touches `apps/cli` in exactly one of those 24 commits, `d4a7f4182`
  "Chore/provider cleanup model refresh (#154)" (7 retired providers).
- files changed on BOTH sides since the merge-base, with the commits involved:
  - `apps/cli/src/lib/utils/provider.ts`: branch `5e06541ef` (provider parity,
    24 providers derived from the registry) vs main `d4a7f4182`;
  - `apps/cli/src/types/types.ts`: branch `5e06541ef`, `bb8588903` vs main `d4a7f4182`;
  - `src/core/assistant-message/presentAssistantMessage.ts`: branch
    `efcde397a` (stop abort crash in handleError -> say re-throw) vs main
    `a2b2e102d` (Feat/34 runtime teaching errors);
  - `src/core/webview/ClineProvider.ts`: branch `627bf3a1c` (mirror
    apiConfiguration to `~/.roo/cli-settings.json`) vs main `912839e57`,
    `d4a7f4182`, `a2b2e102d`;
  - `src/package.json`: branch `f6ed54afd` vs main changesets and knip commits
    (`60b15ab46` reset to 1.0.0, `5286992a2`, `0aaa2713b`, `6ec983eba`);
  - `pnpm-lock.yaml`.

Approach options:
1. Linear rebase, as requested: from a fresh worktree,
   `git rebase --onto main 8f8550ccb <branch>` with
   `--exec "pnpm -C apps/cli check-types"` so every replayed commit type-checks.
   Expect conflicts at the six files above, mostly at `5e06541ef`,
   `627bf3a1c`, `efcde397a` and `f6ed54afd`. Resolve `provider.ts` by keeping
   the registry-derived list AND dropping the seven retired providers (main's
   intent), then re-run `apps/cli` provider tests. Resolve
   `presentAssistantMessage.ts` by keeping main's teaching-errors structure and
   re-applying the abort-crash guard inside it (the guard is small).
2. Single merge of `main` into the branch (one conflict resolution instead of
   up to 38) followed by the usual squash-merge PR, which is how every other
   stack landed on `main` (history on `main` is squashed anyway, so the
   linearity of the branch is not visible after merge). Lower risk; recommended
   unless the user explicitly wants the replayed history.

Risks either way:
- `main` now gates on knip (`0aaa2713b`, `6ec983eba`); the CLI stack adds many
  exports, so `pnpm knip` from the main tree must exit 0 before pushing.
- Changesets: `src/package.json` version was reset to 1.0.0 on `main`; the
  branch's `f6ed54afd` change to that file must not resurrect the old version.
- The installed CLI bundle resolves dependencies fresh at package time; after
  the merge, re-check that `ink` stays pinned at 6.6.0 and that `pnpm-lock.yaml`
  resolves without the 6.8.0 staircase regression.
- After landing, rebuild the CLI bundle and re-run the slice 5 manual checks on
  the installed build, not only on the dev tree.
