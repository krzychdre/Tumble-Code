# CLI: drop terminal control sequences from agent text (audit C-1)

**Status:** done on `fix/sec-cli-escapes`
**Audit:** `private_docs/security-audit-2026-11-06/report.md` C-1
**Touched:**

- `apps/cli/src/lib/utils/terminal-text.ts` (new): `stripTerminalControls()`
- `apps/cli/src/agent/output-manager.ts`: every print mode write goes through it
- `apps/cli/src/ui/components/tools/utils.ts`: `sanitizeContent` uses it; the duplicate in `primitives/ResultRow.tsx` is gone, its importers use the one in `tools/utils.ts`
- tests: `lib/utils/__tests__/terminal-text.test.ts` (new), `agent/__tests__/transcript-printer.test.ts`, `ui/components/primitives/__tests__/ResultRow.test.tsx`

## Problem

Text from the model, a command or an MCP server reaches the terminal. Escape sequences in it act
on the terminal: OSC 52 writes the clipboard, OSC 8 hides a link target, CSI moves the cursor and
erases (an approval prompt can be overwritten), ESC c resets.

## Root cause (verified)

- Print mode: `OutputManager.output/outputError/writeRaw` (`agent/output-manager.ts`) wrote the
  text as is; `TranscriptPrinter.printStreamed` and the ask dispatcher write through it.
- TUI: ink 8 already sanitizes every text node (`ink/build/sanitize-ansi.js`, called from
  `squash-text-nodes.js`): it drops CSI other than SGR, C0/C1 controls and DCS/APC, and drops
  OSC 52 and OSC 0 at output. It keeps OSC 8 hyperlinks (probed with ink-testing-library,
  `<Text>` and `<Static>`). So the report's "ink preserves embedded ANSI" holds only for OSC 8.
  `sanitizeContent` (two identical copies) removed only tabs and CR.

## Fix

One regex pass keeps SGR (`ESC [ params m`), tab and line feed and drops every other CSI (7-bit
and C1), OSC/DCS/SOS/PM/APC strings (an unterminated one up to the end of the text), two-byte
escapes, and C0/C1 controls (CR, BEL, BS, VT, FF, DEL included). Applied in the print mode
writer and in `sanitizeContent` (every transcript row in the TUI). Other TUI text (dialogs,
todos) still relies on ink, which leaves only OSC 8 there.

A sequence split across two streamed print mode slices loses its ESC, so a few characters of it
may show as text; nothing reaches the terminal as a control.

## Tests

- `stripTerminalControls`: parametrized drop cases per kind, OSC 8 keeps the visible text, SGR/tab/LF/non-ASCII unchanged.
- Print mode: a streamed command output row loses OSC 52 and CSI 2J, keeps SGR. Mutation: writer without the call, red.
- TUI: `ResultRow` with an OSC 8 link renders `see docs` without `ESC ]`. Mutation: old `sanitizeContent`, red.
