# The code index status in the CLI footer

Status: in progress.

## Problem

Third part of "code indexing in the CLI as in VS Code, with an icon in the status" (#1375 watcher, #1376 settings).
The extension already posts `indexingStatusUpdate` (systemStatus, processed and total items, message) to its view,
which the CLI host receives, but the terminal UI ignored it.

## Fix

- `transcript-reducer.ts`: `indexingStatusUpdate` becomes `setCodeIndexStatus`; the store keeps
  `codeIndexStatus`, process-wide like the cloud status (both resets keep it).
- `InputFooter`: a code index segment first on the right: `◐ index 42%` (share of the current batch) while
  indexing, `● index` (success colour) once indexed, `✗ index` (error colour), `○ index stopping`; nothing in
  Standby (index off), not even a separator.
- `App`: an Error status shows its message once as an error toast ("Code index: ..."), since the footer has room for
  the mark only. A long toast takes the footer's width for its few seconds, then the mark is back.

## Tests

`InputFooter.test.tsx` (each state, order, Standby renders as no index), `transcript-reducer.test.ts`,
`store.test.ts`, `App.characterization.test.tsx` (message to footer, toast, mark after the toast; the test now
starts every case from fresh stores, since process-wide state survives `reset()`); mutation-checked.
