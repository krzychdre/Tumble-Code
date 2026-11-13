# R4 C8: MultilineTextInput without the one-value flag and the copied edit block

- **Status:** done
- **Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item C8)

## Touched files

- `apps/cli/src/ui/components/MultilineTextInput.tsx`
- `apps/cli/src/ui/components/autocomplete/AutocompleteInput.tsx`
- `apps/cli/src/ui/components/__tests__/MultilineTextInput.test.tsx`

## Problem

`showCursor` had one caller value (`true`, `AutocompleteInput`), so its four guards never fired. The edit step
(set both refs, `onChange`, `setCursorIndex`) was copied for new line, Backspace and typing; Up and Down were
mirrored copies of one line move.

## Change

- `showCursor` is gone.
- `applyEdit(newValue, newCursorIndex)` and `moveCursor(index)` update the refs first (the next keystroke can
  arrive before React re-renders), then the parent and the state.
- `moveLine(-1 | 1)` moves between lines keeping the column (clamped by `getIndexFromPosition`) and hands over to
  `onUpAtFirstLine` / `onDownAtLastLine` past the first or last line.

## Tests

- New: "moves between lines keeping the column, clamped to a shorter line, and edits at the cursor".
- Mutations: `col + 1` in `moveLine` turns the new spec red; dropping `valueRef.current = newValue` in
  `applyEdit` turns 5 specs red; restored.
- `npx vitest run src/ui/components --maxWorkers=2`: green. `tsc --noEmit`, eslint, `pnpm knip`: clean.
