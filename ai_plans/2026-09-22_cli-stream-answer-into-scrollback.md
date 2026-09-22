# CLI: stream the answer into scrollback paragraph by paragraph

Branch: `feat/cli-stream-answer-into-scrollback`, stacked on
`fix/cli-static-rows-overflow-width` (both touch the `<Static>` block of
`App.tsx`).

## Report

"I often see the last line filling up (it moves and disappears, until the
whole reply is finished, and only then I get all of it). Not a nice feeling."

## What happened (proven)

Byte captures (17x200 and 40x120 pseudo terminals, GLM-5.3, method in
`2026-09-22_cli-incremental-render-ghost-rows.md`), screens during the answer
stream on the old build:

```
  … +17 lines (prints in full when this message completes)
●
  Dekodowanie: S32/U32 zajmują dwa rejestry (30613+30614, ...
○ Kerplop… (esc to interrupt · 132s · ↓ 3.8K tokens)
```

Two causes stacked:

1. By design, a streaming message lives in the dynamic tail, which
   `DynamicTailMessage` clamps to `tailRowsPerMessage` rows
   (`max(3, (rows - 12) / n)`), because an unbounded tail breaks ink's erase.
   Nothing reached scrollback before the message completed, so the user
   watched the last 2-3 rows of the answer and the rest vanished until the
   end.
2. Even an answer at the head of the tail could not be printed earlier,
   because the reasoning message above it stays `partial` in the CLI store
   for the whole answer. Logged from the live store (temporary instrumentation
   of `App.tsx`, 3 runs): the tail was `[thinking partial, assistant partial]`
   for 6967 / 5688 / 6778 ms, i.e. until the answer was complete. The core does
   finalize the reasoning 3 ms after the text starts (`ui_messages.json`), but
   under a new ts, and the CLI learns about it only at the next full state
   push. `getStaticCount` rule 4 (everything from the first partial onward
   stays dynamic) therefore pinned the answer below it.

## Change

- `apps/cli/src/ui/streamCommit.ts` (pure, tested): every line of the
  streaming answer that is complete (followed by `\n`) is committed as a
  chunk, never inside an open fenced code block (`Markdown` renders a fence as
  one block). `remainderAfterCommit` gives the unprinted rest, or `null` if
  the content no longer starts with the printed prefix (then the whole message
  is printed again: repeating beats losing text). `tailHeads` picks the
  `streaming` head (first tail message, assistant, partial: may commit) and
  the `committed` head (first tail message with a commit: its chunks stay in
  the item list until it is promoted).
- `transcript.ts`: `StaticItem` gains `chunk` items and a `continuation` flag
  on `message` items. `buildStaticItems` emits, per promoted message, its
  chunks then its rest (nothing if the chunks covered it); the committed
  tail head's chunks come last. The list only ever grows while a task runs,
  which ink's `<Static>` requires (it prints `items.slice(printed)`).
- `getStaticCount(..., { settleSupersededThinking })`: a partial thinking
  message that another message already follows counts as settled. `App`
  enables it only for the collapsed transcript, where the thinking row is the
  content-independent "∴ Thinking…" one-liner. The expanded transcript prints
  the reasoning body, which could still lack its last chunk, so it keeps the
  strict rule (the answer then prints at the end, as before).
- `App.tsx`: `streamCommits` state (reset with the `<Static>` region on a
  remount or an empty transcript), an effect advancing the commit of the
  streaming head, and the tail renders only the head's remainder, as a
  continuation.
- `AssistantMessage` / `DynamicTailMessage` / `TranscriptStatic`: continuation
  rendering (2-column indent instead of the bullet, no top margin, nothing for
  an empty rest).

### Trap caught while writing it

Keying the chunk list on `partial` would drop the head's chunks from the item
list between its finalization and its promotion (the trailing message is
held back while loading). Ink's `<Static>` then lowers its printed index to
the shorter length and prints the chunks a second time on promotion. The
sequence test in `transcript.test.ts` fails in exactly that way when the
`committed` head is keyed on `partial` (mutation checked).

## Verification

- Unit: `streamCommit.test.ts` (8), `transcript.test.ts` (+7: append-only
  sequence through stream, finalization while loading and idle promotion;
  full reprint on divergence; no closing item when covered; four
  `settleSupersededThinking` cases).
- Pty, new build, checker `verify_stream.py` (every paragraph of the final
  answer from the task file appears exactly once in scrollback + screen; the
  largest "+N lines" shown during the stream):

    | run                    | paragraphs once | max hidden lines |
    | ---------------------- | --------------- | ---------------- |
    | 17x200 x5, 40x120 x2   | all             | 0 or 1           |
    | numbered bold x2       | all             | 0 or 1           |
    | old build, same prompt | (n/a)           | 10 and 17        |

    A mixed session (8 commands with a comment after each, 30x160): 16 texts
    and commands, all present once, in the core's order.

- One early run reported zero matches for every paragraph; the cause was the
  checker (it stripped `**` from the expected text only, while `Markdown`
  prints list items with literal asterisks, see below). Fixed checker, two
  numbered-bold runs: complete.

## Residuals, not changed here

- The paragraph still being written is clamped as before; a single paragraph
  longer than the row budget shows its tail with "… +0/1 lines".
- `Markdown.tsx`: ordered and unordered list items do not get inline
  formatting (`**bold**` prints with its asterisks), and every line containing
  `|` is treated as a table boundary and printed as a tab plus an ideographic
  space (table rows and prose with a pipe show as an empty bullet line).
- Rows that start with a stray leading space after ink's `wrap-ansi` break
  (`trim: false`), cosmetic.
