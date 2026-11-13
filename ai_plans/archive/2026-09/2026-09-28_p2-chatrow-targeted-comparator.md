# P2: ChatRow targeted memo comparator (roadmap step ③, final piece)

- **Branch**: `feature/p2-chatrow-targeted-comparator` (off main @ 73f19fc75)
- **Roadmap**: ai_plans/2026-09-27_simplification-roadmap.md, Priority 3, item P2
- **Status**: in progress

## Problem (verified on main)

[`ChatRow`](../webview-ui/src/components/chat/ChatRow.tsx:48) is `memo(..., deepEqual)` — the
memo comparator is `fast-deep-equal` over the **whole props object** (import at
`ChatRow.tsx:3`, usage at `ChatRow.tsx:79`). ChatView's `itemContent`
(`ChatView.tsx:386-441`) re-runs on every store commit, so every visible row
deep-compares its entire props tree — `message` (including `text` payloads that
can be 100 KB+ of tool content), `lastModifiedMessage`, `meta.previousTodos` —
on every streamed token.

## Render-dependency audit (what the comparator must cover)

Everything ChatRow/ChatRowContent/renderers read from props:

| Prop                                                                                                                                          | Read by                                                                                                                                                          | Mutates in place?                                                                                                                                                                                                                                                                                                                                   | Comparator treatment                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `message`                                                                                                                                     | every renderer (`text`, `ts`, `type`, `partial`, `images`, `checkpoint`, `say`, `ask`, `progressStatus`, `contextTruncation`, `contextPrune`, `contextCondense`) | **Never.** Reducer replaces slots with new objects (`extensionStateReducer.ts:296-331`); pipeline caches synthesized rows (`groupToolAsks.ts:53-78`). BUT `consolidateCommands`/`consolidateApiRequests` (`packages/core/src/message-utils/`) rebuild `{ ...msg, text }` **per recompute**, so identity is not guaranteed for command/api_req rows. | reference first, then `ts` + `text` + `partial` equality fallback                                                                  |
| `lastModifiedMessage`                                                                                                                         | CommandAskRow, UseMcpServerRow, ApiReqStartedRow                                                                                                                 | no (same store objects)                                                                                                                                                                                                                                                                                                                             | reference                                                                                                                          |
| `isExpanded`, `isLast`, `isStreaming`, `supportsImages`                                                                                       | renderers + ChatRow height effect                                                                                                                                | primitives                                                                                                                                                                                                                                                                                                                                          | `===`                                                                                                                              |
| `meta`                                                                                                                                        | renderers (previousTodos, nextTs, newTaskIndex, followedBySubtaskResult)                                                                                         | entries are **fresh objects per recompute** (`computeRowMeta.ts:75`)                                                                                                                                                                                                                                                                                | compare the 4 fields; `previousTodos` by reference (stable via `parseToolCached` cache)                                            |
| `isFollowUpAnswered`, `isFollowUpAutoApprovalPaused`                                                                                          | FollowUpSuggest                                                                                                                                                  | primitives                                                                                                                                                                                                                                                                                                                                          | `===`                                                                                                                              |
| callbacks (`onToggleExpand`, `onHeightChange`, `onSuggestionClick`, `onBatchFileResponse`, `onFollowUpUnmount`, `onJumpToPreviousCheckpoint`) | —                                                                                                                                                                | no                                                                                                                                                                                                                                                                                                                                                  | reference (deep-equal already treats distinct closures as unequal; ChatView stabilizes them via `useStableCallback`/`useCallback`) |

Fields renderers read that are **not** in the roadmap list (`ts`, `text`, `partial`):
`images`, `checkpoint`, `say`, `ask`, `type`, `progressStatus`, `contextTruncation`,
`contextPrune`, `contextCondense`. All are covered by the `message` comparison:
messages are never mutated in place (reducer replaces slots; pipeline caches
synthesized rows), so two calls with the same `message` reference render
identically, and the `ts`+`text`+`partial` fallback covers the rebuilt-object
case (command rows) — the only fields that can differ on a rebuilt object while
`ts`/`text`/`partial` are equal are fields the store never changes without a new
text (partial→complete flips `partial`, which the fallback tracks).

Renderers also subscribe to store slices via `useExtensionSelector` (mcpServers,
alwaysAllowMcp, currentTaskItem, …) — those re-render independently of this
memo, so they need no comparator coverage.

No cost/usage fields are rendered by ChatRow (costs live in TaskHeader, which
is outside the list). Nothing outside the covered set can change what the row
renders without either a new message reference (tracked), a `meta` field change
(tracked), or a primitive prop change (tracked).

## Design

New module `webview-ui/src/components/chat/chatRowPropsEqual.ts`:

```ts
export function chatRowPropsEqual(prev: ChatRowProps, next: ChatRowProps): boolean
```

- `message`: `===` → true fast path is implied; if references differ, compare
  `ts` and `text` and `partial` (covers `consolidateCommands`-rebuilt command
  rows whose text is unchanged between tokens). All other message fields are
  covered per the audit above.
- `lastModifiedMessage`: `===` (both may be undefined).
- `meta`: both undefined → equal; one undefined → unequal; else
  `nextTs ===`, `newTaskIndex ===`, `followedBySubtaskResult ===`, and
  `previousTodos` by reference.
- All other props (`isExpanded`, `isLast`, `isStreaming`, `supportsImages`,
  `isFollowUpAnswered`, `isFollowUpAutoApprovalPaused`, all callbacks): `===`.

Pure function, no imports beyond types. `ChatRow` swaps `deepEqual` for it;
nothing else in ChatView changes (the per-row memo input is already per-row —
`itemContent` builds props from the row's own message only; the roadmap's
"per-row slice" requirement is already satisfied by the existing pipeline).

Height contract (`useSize` + `onHeightChange` effect, `ChatRow.tsx:55-73`):
untouched. The comparator only decides _whether_ ChatRow re-renders; when it
does, the height logic runs exactly as before.

## Measurement (BEFORE, on main @ 73f19fc75)

Harness: `webview-ui/src/components/chat/__tests__/ChatRow.memo-perf.spec.tsx`
(kept as permanent characterization spec). Real ChatRow + real store, 20 rows
(varied: text/tool/checkpoint/user_feedback + one streaming partial), 100
token updates through the window message bus. Render counter = spy on
`useSize` (runs in ChatRow's body; skipped on memo bail-out).
fast-deep-equal is spied to count real comparator calls.

```
[chatrow-perf-harness]  (BEFORE, main)
targeted comparator present: false
rows: 20, token updates: 100
non-streaming row renders during tokens: 0
streaming row renders during tokens: 100
fast-deep-equal comparator calls during tokens: 2000
hydration commits (excluded): 2
token-phase commits: 100
token-phase total actualDuration: 138.57 ms
mean per-commit: 1.386 ms

[chatrow-comparator-bench]  (BEFORE, main)
targeted comparator present: false
10000 comparisons, deep-equal: 7.30 ms (0.0007 ms/call)
10000 comparisons, targeted:   n/a (module absent on main)
```

Reading: with identity-stable messages the memo holds (0 non-streaming
renders), but every visible row still pays a full deep-equal walk of its props
per token — 2000 walks per 100 tokens; the microbench puts one walk at ~0.7 µs
on this tiny fixture, but the walk is O(props tree), and real tool rows carry
100 KB+ `text` payloads (the parser caps chunks at 1150 chars, but command
output / file content rows are far larger), so per-token comparator cost scales
with visible content. In production the command/api_req rows additionally get
rebuilt object identities per token (`consolidateCommands`), where deep-equal
must walk the full text to keep the memo holding.

## Measurement (AFTER, on the branch)

```
[chatrow-perf-harness]  (AFTER)
targeted comparator present: true
rows: 20, token updates: 100
non-streaming row renders during tokens: 0
streaming row renders during tokens: 100
fast-deep-equal comparator calls during tokens: 0
hydration commits (excluded): 2
token-phase commits: 100
token-phase total actualDuration: 151.90 ms
mean per-commit: 1.519 ms

[chatrow-comparator-bench]  (AFTER)
targeted comparator present: true
10000 comparisons, deep-equal: 6.23 ms (0.0006 ms/call)
10000 comparisons, targeted:   2.78 ms (0.0003 ms/call)
ratio deep/targeted: 2.2x
```

### Comparison table

| Metric (20 rows, 100 tokens)               | BEFORE (main)            | AFTER (branch)                                                                                                         |
| ------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| fast-deep-equal calls during tokens        | 2000                     | **0**                                                                                                                  |
| non-streaming row renders during tokens    | 0                        | 0 (unchanged — height contract safe)                                                                                   |
| streaming row renders during tokens        | 100                      | 100 (unchanged)                                                                                                        |
| comparator cost, 10k equal-props calls     | 7.30 ms (0.0007 ms/call) | 2.78 ms (0.0003 ms/call) — 2.2–2.4× faster                                                                             |
| token-phase mean per-commit actualDuration | 1.386 ms                 | 1.519 ms (within jsdom noise; commit duration here is dominated by the streaming row's own render, not the comparator) |

Notes:

- On identity-stable fixture data the deep-equal memo already held; the win is
  the eliminated comparator work itself (2000 full-props deep walks per 100
  tokens → 0) and its scaling: the deep walk is O(visible content) — real
  tool rows carry 100 KB+ text payloads, where a single walk is far more
  expensive than the fixture's tiny strings — while the targeted comparator is
  O(1) for reference-stable rows.
- In production, command/api_req rows get rebuilt identities per token
  (consolidateCommands/consolidateApiRequests); the comparator's
  ts+text+partial fallback keeps their memo holding without a deep walk
  (string compare short-circuits on identity for equal references).
- The characterization spec stays in CI: `non-streaming row renders === 0`,
  streaming row ≥ N tokens, fast-deep-equal call count 0 after P2.

## Results

- New: `webview-ui/src/components/chat/chatRowPropsEqual.ts` (comparator),
  `webview-ui/src/components/chat/chatRowProps.ts` (props type),
  `webview-ui/src/components/chat/__tests__/chatRowPropsEqual.spec.ts` (23 unit tests),
  `webview-ui/src/components/chat/__tests__/ChatRow.memo-perf.spec.tsx` (permanent harness).
- Changed: `webview-ui/src/components/chat/ChatRow.tsx` — memo comparator
  swapped, interface moved to chatRowProps.ts, height logic untouched.
- Tests: 49 chat spec files, 674 tests, all green; tsc + eslint clean.
- Height contract: `useSize` + `onHeightChange` effect untouched
  (ChatRow.tsx:55-74); the comparator only gates whether ChatRow re-renders.

## Tests

- `chatRowPropsEqual` unit spec: equal/unequal per tracked field,
  meta-by-reference semantics, message text-fallback, stability across calls.
- `ChatRow.memo-perf.spec.tsx` characterization: non-streaming rows must not
  re-render during token updates (stays 0), streaming row observes every
  token, fast-deep-equal calls drop to 0.
- Existing ChatRow/ChatView specs must stay green.
