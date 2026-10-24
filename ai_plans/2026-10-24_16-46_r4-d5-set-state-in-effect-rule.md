# r4 D5 batch 6: last findings and `set-state-in-effect` back on

## Status

Done. `react-hooks/set-state-in-effect` is an error again (the recommended preset's level) for webview-ui.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (D5)
- batches 1 to 5: `ai_plans/2026-10-24_*_r4-d5-*-set-state.md`

## Touched files

- `packages/config-eslint/react.js` (the `"off"` override is gone)
- `webview-ui/src/components/common/FormattedTextField.tsx`, `MermaidBlock.tsx`
- `webview-ui/src/components/history/useTaskSearch.ts`
- `webview-ui/src/components/code-index/useIndexingStatus.ts`
- `webview-ui/src/hooks/useScrollLifecycle.ts` (targeted disable)
- specs: `FormattedTextField.spec.tsx`, `MermaidBlock.spec.tsx`

## Problem

Four findings left after batches 1 to 5, plus the one effect in `useScrollLifecycle` that stays.

## Change

- `FormattedTextField`: the effect copied the formatted value into `rawInput` while not typing, but the field
  shows `formatter.format(value)` then and reads `rawInput` only while typing. The effect is gone.
- `MermaidBlock`: new code sets loading and clears the error in render (previous-value state); it starts loading.
- `useTaskSearch`: the switch to "most relevant" on a search and back on clearing runs in render; each branch
  changes its own condition, so it settles in one extra render.
- `useIndexingStatus`: follows the parent's status in render (previous-value state).
- `useScrollLifecycle`: `// eslint-disable-next-line react-hooks/set-state-in-effect` on the task-switch reset of
  the scroll-to-bottom button. The button must hide in the same step that moves the scroll phase, which lives in a
  ref and changes in that effect next to the hydration timers; hidden in render, a Virtuoso
  `atBottomStateChange` that still sees the old phase shows it again (`ChatView.scroll-debug-repro.spec.tsx`).

## Tests

New cases, green before and after: FormattedTextField shows a new parent value unless the user is typing;
MermaidBlock drops the old error and shows loading for new code. `useTaskSearch.spec.tsx` and
`CodeIndexPopover.sections.spec.tsx` already cover the other two.

Mutation checks, each turned a spec red: the MermaidBlock loading and error resets, both sort switches, the
indexing status follow, and `displayValue` reading `rawInput` outside typing.

Whole webview-ui suite: 271 files, 3893 tests pass. `eslint src --max-warnings=0` passes with the rule on; tsc;
React Compiler bailouts unchanged (2).
