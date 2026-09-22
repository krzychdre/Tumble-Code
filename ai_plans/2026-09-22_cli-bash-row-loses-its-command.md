# The Bash row prints twice and never shows its command

## What the user sees

Every executed command produces two `Bash` rows in the transcript, neither of
which says what was run:

```
●
● Bash
  ⎿   85:dist.init_process_group(backend="cuda:nccl,cpu:gloo", device_id=device)

● Bash
  ⎿   85:dist.init_process_group(backend="cuda:nccl,cpu:gloo", device_id=device)   … +31 lines
      86:dist.barrier()
      87:master_process = (rank == 0)
```

The first row carries one line of output, the second the whole thing, and the
`… +31 lines` marker floats at the top right of the block instead of sitting
under the last visible line.

## Evidence, from the exact session in the screenshot

Task `01a0c926-37f8-7458-96fa-bb549542877e` in
`~/.vscode-mock/global-storage/tasks`. One command execution is recorded as
four messages:

```
1790082143805 ask  command        partial=false  len=161   curl -s "https://raw.githubusercontent…"
1790082144847 say  command_output partial=true   len=75    85:dist.init_process_group(…)
1790082144847 ask  command_output partial=false  len=0     (the "leave it running?" ask)
1790082144879 say  command_output partial=false  len=2309  85:dist.init_process_group(…)\n86:…
```

The two `say: command_output` entries carry **different timestamps**, and the
CLI keys messages by timestamp. The 75-character one is the first chunk; the
2309-character one is the complete output, which the screenshot renders as
`… +31 lines`. The `gc.collect()` pair further down the same file is
13 characters versus 4058, which is the screenshot's `… +72 lines`. The rows in
the screenshot are therefore these message pairs, one row each.

### Why the core emits two messages instead of finalizing one

`Task.say()` continues a partial in place only while that partial is still the
**last** message. The non-blocking `ask: command_output` lands between the first
chunk and the final output (same millisecond, see the timestamps above), so the
partial is no longer last and the finalization is appended as a new message.
The first message is then abandoned with `partial: true` forever, which also
pins every later message of the turn in the height-clamped dynamic tail until
the agent goes idle (`getStaticCount` rule 4).

### Why the command text disappears

`useMessageHandlers` keeps the command in `pendingCommandRef`, set from
`ask: command` and consumed by the first `say: command_output`, which nulls it.
The second `say: command_output` therefore builds
`toolData = { tool, command: undefined, output }`, and `addMessage`'s
non-partial branch replaces the stored message **wholesale**
(`updated[existingIndex] = msg`, store.ts:239), so even the row that did have a
command loses it the moment its finalization arrives.

## The fix

### One row per command execution

`handleSayMessage` gains a command-output stream, tracked like the existing
answer/reasoning merge:

- `ask: command` opens an execution: remember the command text and forget the
  previous execution's row.
- The first `say: command_output` of an execution creates the row and records
  its id.
- Every later `say: command_output` of the same execution is routed to that id
  instead of adding a message, exactly as `mergedStreamIds` routes a restarted
  answer stream. The raw timestamp is mapped to the row id so later state
  replays land on the same row.

The merge is allowed only while the agent is loading or while a resumed task is
being replayed, which is when the row is guaranteed to still be re-renderable
(`<Static>` never rewrites what it printed). Outside those windows the delivery
falls through and renders on its own, which is worse-looking but never loses
output.

### The command survives every delivery

The command is held for the whole execution rather than consumed by its first
use, so the finalization rebuilds `toolData` with the command still in it. The
reference is cleared when the next `ask: command` arrives.

### Streaming output actually updates

`addMessage`'s debounced partial path only carried `content`, so a row's
`toolData.output` stayed at the first chunk for the whole command. The queue now
carries the `toolData` patch too, and the flush applies it.

### What the row prints (the user's call)

Collapsed: the command on one line, hand-truncated to the terminal width, plus
the first lines of output and a `… +N lines (ctrl+o)` tail.
Expanded (ctrl+o): the command verbatim including newlines (heredocs and
`python3 -c "…"` blocks are readable again) and the whole output.

Hand truncation rather than ink's `wrap="truncate-end"`: ink hands the text one
column more than the row has left, which wraps the header onto a second row
(plan 2026-09-22 coloured diffs, same trap).

### The truncation marker sits under the output, not beside it

`ResultRow`'s inner `<Box>` had the default `flexDirection: "row"`, so the
`… +N lines` text was laid out as a second **column** next to the output block,
one line down. It becomes a column layout, which puts the marker where every
other CLI puts it.

## Files

- `ui/hooks/useMessageHandlers.ts`: the command-output execution tracking.
- `ui/store.ts`: `toolData` travels with debounced partial updates.
- `ui/components/tools/CommandTool.tsx`: header and output rendering.
- `ui/components/primitives/ResultRow.tsx`: marker placement, `(ctrl+o)` hint.

## Tests

- `useMessageHandlers.test.tsx`: the four-message sequence above, replayed
  verbatim, produces ONE tool message that carries the command and the full
  output, and leaves nothing partial.
- `CommandTool.test.tsx`: collapsed truncates a long command to one line and
  caps the output; expanded prints both in full; a multi-line command is
  flattened when collapsed and kept verbatim when expanded.
- `ResultRow` marker placement asserted through `CommandTool.test.tsx`: the
  marker is on its own line, after the last visible output line.

## Observed but not fixed here

Resuming a task whose history contains `ask: command` replays those asks through
`setPendingAsk`, so a stale approval dialog can appear for a command that ran
long ago. It predates this change and belongs to the resume path, not the
renderer.
