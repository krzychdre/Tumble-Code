# CLI: the running block streams live in the expanded transcript (ctrl+o)

**Status:** implemented on `feat/cli-command-execution-timeout` (the user asked for it on the same branch as the timeout change), committed, not pushed
**Related plans:** `2026-09-21_cli-answer-lost-in-dynamic-tail.md` (invariants I1 and I8, which this change narrows), `2026-09-22_cli-ctrl-o-expands-but-never-collapses.md` (what ctrl+o does to scrollback), `2026-09-22_cli-stream-answer-into-scrollback.md` (why an answer streams in the collapsed transcript)
**Touched:**

- `apps/cli/src/ui/components/DynamicTailMessage.tsx` (`expanded` prop, `liveBody`, `liveWindow`)
- `apps/cli/src/ui/utils/tailClamp.ts` (`indent` parameter, shared `hiddenLinesMarker`)
- `apps/cli/src/ui/App.tsx` (passes `verboseTranscript` to the tail)
- doc comments that stated the old rule: `ChatHistoryItem.tsx`, `messages/ThinkingMessage.tsx`, `tools/types.ts`
- tests: `components/__tests__/DynamicTailMessage.test.tsx` (7 new), `utils/__tests__/tailClamp.test.ts` (1 new)

## Symptom

User, 2026-09-23: after ctrl+o the block that is still running (thinking, a Bash
command, and so on) is not expanded, and its content cannot be seen until the
block finishes. Request: let the expanded view (ctrl+o) show the current block
while it streams.

## Root cause

A design rule, not an accident. The 2026-09-21 plan fixed two invariants:

- I1: the dynamic tail (everything ink re-renders, under `TailViewport`) must stay
  below the terminal height, so "`DynamicTailMessage` never passes `expanded` to
  `ChatHistoryItem`";
- I8: thinking content is shown only in `<Static>`, never in the tail.

So `App.tsx` rendered every tail message without `expanded`, whatever
`verboseTranscript` said. A running thinking block drew `∴ Thinking…`, a running
Bash row drew its header and `⎿ … +N lines (ctrl+o)`, and the text appeared only
when the message was promoted into `<Static>` at the end of the block.

The data was there all along. The core re-says the whole reasoning block on every
chunk (`TaskStreamProcessor.ts`, `say("reasoning", …, partial=true)`), and
`ExecuteCommandTool.ts` re-says the whole compressed output as a partial
`command_output` every 150 ms; `useMessageHandlers` routes every delivery of one
execution to one row and the store applies them with a 150 ms debounce. Only the
rendering hid them.

### Evidence (pty measurement, before the fix)

Harness in `/tmp/roo-live-expand-e2e` (ephemeral, recipe below). A fake
OpenAI-compatible server streams 24 reasoning lines, one every 0.3 s, then calls
`execute_command` with a loop printing 30 stamped lines, one every 0.2 s. A
pexpect driver presses ctrl+o two seconds in and records, with pyte, when each
line first appears on the visible screen.

| build              | reasoning line delay (min / median / max) | command line delay (min / median / max) |
| ------------------ | ----------------------------------------- | --------------------------------------- |
| before (f9a72ecb1) | 0.68 / 4.28 / 7.58 s                      | 0.62 / 3.71 / 6.58 s                    |
| after              | 0.31 / 0.46 / 0.46 s                      | 0.02 / 0.36 / 0.57 s                    |

Before: line 1 waited 7.58 s, line 24 0.68 s, i.e. all 24 lines appeared at once
when the block ended; the screen at t=6 s showed the `-- expanded transcript --`
divider and a bare `∴ Thinking…` in the tail.

## Change

In the expanded transcript the tail shows the growing body of a running block as a
window of its NEWEST rows, like `tail -f`, cut to the message's existing row budget
(`tailRowsPerMessage`). A marker line on top says how much is hidden, with the same
wording the assistant clamp already used: `… +N lines (prints in full when this
message completes)`. When the block completes, the promotion prints it in full into
scrollback exactly as before; the window is never printed.

- `liveBody(message)` names the growing body: the content of a `thinking` message,
  `toolData.output` (falling back to `content`, as `CommandTool` does) of an
  `execute_command` row, `toolData.content` of a `use_mcp_server` row. Everything
  else returns `null` and renders as before.
- `liveWindow` sanitizes the body the way the renderers do (tabs, `\r`, trailing
  newlines), clamps it to `maxRows - 2` rows (header and marker) with the
  renderer's indent (4 for thinking, 7 for a tool row: bullet 2 + `  ⎿  ` gutter 5),
  prepends the marker when lines were hidden, and returns the message with the
  body replaced. `DynamicTailMessage` then renders `ChatHistoryItem` with
  `expanded`. The marker is part of the body text, so neither `ThinkingMessage`
  nor `ResultRow` needed a new prop, and it lands right under the block's header.
- `clampTail` got an `indent` parameter (default 4, unchanged behaviour for the
  assistant clamp) and `hiddenLinesMarker` so both markers share one wording.

### Invariants after the change

- I1 holds in a narrower form: the tail may render `expanded`, but only for a
  message whose growing body was cut to the row budget first. An expanded body is
  never drawn uncut in the tail, and `TailViewport` still clips the whole tail at
  `rows - 2` as the last line of defence.
- I8 is relaxed on purpose: thinking content now appears in the tail, but only in
  the expanded transcript, i.e. only when the user asked for it with ctrl+o.

### Rejected alternatives

- Stream the thinking and the command output into scrollback line by line, as the
  answer does (`streamCommit.ts`). A chunk printed into `<Static>` can never be
  taken back, and the final text does not always extend what was printed:
  `Terminal.compressTerminalOutput` may drop the middle of a long output, and a
  restarted reasoning stream is merged into the old message. `messageItems` would
  then print the whole block again (duplicate). The window has nothing to take back.
- Expand every tool renderer in the tail. Only these three bodies grow while the
  block runs; file reads, searches and edits arrive complete, can be large (a
  300-line diff), and print expanded seconds later anyway.
- A structural per-message clip (a nested `TailViewport`). It would bound any
  renderer exactly, but cannot tell how many lines it hid, and each tail message
  would mount one (the first frame of a mount is uncapped, see the 2026-09-21 tail
  viewport plan). The text clamp gives an exact count; the outer viewport covers
  the rare tall header (a multi-line heredoc command, printed verbatim when expanded).

## Verification

- `pnpm vitest run src/ui` in `apps/cli`: 47 files, 531 tests pass; `tsc --noEmit`,
  eslint and prettier clean on the touched files.
- New unit tests: collapsed thinking stays one line; expanded thinking and command
  output show the newest lines under the marker and stay within `maxRows`; an MCP
  response the same; a short body has no marker; one endless reasoning paragraph
  without newlines stays within `maxRows + 1`; a `read_file` row renders the same
  expanded as collapsed.
- pty measurement after the fix: see the table above. The whole terminal transcript
  (pyte `HistoryScreen`, scrollback plus screen) holds every reasoning and output
  line exactly once, one `Bash(` header, two `Thinking` headers, no leftover marker.
  The screen at t=16.4 s showed `⎿  … +4 lines (prints in full …)` over output
  lines 05..30 (budget 28 rows with one message in the tail).
- Toggle run (`PRESS=5.0,13.0`: expand mid-thinking, collapse mid-command): the
  already streamed lines appear at the press (hence a max delay of 2.8 s for lines
  sent before it). At t=12.3 s the Bash row showed output lines 01..10 live; after
  the collapse, at t=14.3 s, the screen was the reprinted collapsed transcript
  (`∴ Thinking…`, `Bash(…)`, `⎿  … +22 lines (ctrl+o)`, the counter still growing
  to +30), one copy of each row. The "exactly once" count is vacuous for this run:
  the collapse wipes scrollback and nothing afterwards prints a body, so the final
  transcript holds no marker lines at all; the frames are the evidence.

### Measurement trap: `date` on this host

A few command lines showed a NEGATIVE delay. The stamps themselves are wrong:
`date` here is uutils coreutils 0.10.0, and the same loop run in a plain shell,
without the CLI, prints a stamp about 0.5 s too late roughly once per second
(`OUT_LINE_09 …197.252 after OUT_LINE_08 …197.472`). The persisted
`ui_messages.json` of the before run has the same pattern, so neither the CLI nor
the core is involved. Ignore those rows or stamp with `python3 -c 'import time;
print(time.time())'`.

### Harness recipe

- `fake_openai.py <port>`: request 0 streams `reasoning_content` lines
  `R0_LINE_nn` (0.3 s apart, logged with `time.time()` to `emitted.log`), then an
  `execute_command` tool call; later requests stream three `R1_LINE_nn` lines and
  call `attempt_completion`.
- `drive.py <label> <port> <dist dir>`: isolated `HOME` with a
  `cli-settings.json` pointing the `openai` provider at the fake server, spawns
  `node <dist>/index.js -e ~/.roo/cli/extension -w ws go` in a 40x120 pty with
  `CI`/`CONTINUOUS_INTEGRATION` unset (ink's CI mode never moves the cursor),
  presses ctrl+o at the times in `PRESS`, polls the screen every 50 ms.
- A copied `dist` needs `node_modules` next to it
  (`ln -s <repo>/apps/cli/node_modules /tmp/roo-live-expand-e2e/node_modules`),
  otherwise the process dies on the first `require("react")` and the run records
  nothing.
- A scratch `ink-testing-library` render of a `partial` tool row never exits on its
  own: the running bullet blinks on a `setInterval`.

## Known limits

- In the expanded transcript a thinking message stays pinned in the tail until the
  core finalizes it at the end of the API stream (`getStaticCount` keeps the strict
  rule there because the expanded body might still lack its last debounced chunk).
  Until then the answer below it streams in its own window instead of into
  scrollback as it does in the collapsed transcript. Unchanged by this work;
  making it stream would need the "flush pending updates before appending a new
  message" ordering plus a guard for restarted reasoning streams.
- The row estimate is character based and ink wraps at word boundaries, so a window
  can come out a row taller than its budget; `TailViewport` absorbs it.
- The collapsed-mode assistant clamp still treats a single over-long line as "not
  clamped" (`hiddenLines === 0`) and draws it uncut; `liveWindow` does not have that
  gap because it always renders the clamped text. Left as it was.
