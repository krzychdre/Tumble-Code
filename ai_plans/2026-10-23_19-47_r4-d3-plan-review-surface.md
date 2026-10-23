# R4 D3: PlanReviewSurface with one note editor and an AnnotationList

**Status:** done

**Related plans:** [maintenance audit round 4](2026-10-23_17-20_maintenance-audit-round-4.md), item D3.

## Touched files

- `webview-ui/src/components/plan-review/PlanReviewSurface.tsx`
- `webview-ui/src/components/plan-review/__tests__/PlanReviewSurface.spec.tsx`

## Problem

The surface kept two note editors in nine `useState` calls (new note: `showNoteEditor`, `noteEditorText`,
`pendingQuote`, `editorPos`; edit note: `editingId`, `editingText`; plus `candidateQuote` and `chipPos` for the
chip), built the notes panel as a 65-line JSX tree inside a `useMemo` with eight dependencies, had a className
ternary with identical branches, and took an `initialAnnotations` prop only the spec passed.

## Change

- One `editor: { kind: "new", quote, pos, text } | { kind: "edit", id, text } | null` state and one
  `chip: { quote, pos } | null` state; `useState` count 5. Opening one editor closes the other.
- `handleSaveEditor` saves either kind; an empty (whitespace) note closes the editor without a change, as before.
- `AnnotationList` renders the notes panel (empty state, quote, note, edit and delete buttons, inline edit form).
- `initialAnnotations` is gone; the markdown area has one className.

## Tests

- The spec drives the real UI: `addNote` selects the quote with a DOM Range, fires mouseup, clicks the "Add note"
  chip, types and saves. jsdom has no layout, so the spec gives `Range.getBoundingClientRect` a size.
- New cases: a note added on a selection is listed and enables Send; an empty note is not added; a listed note is
  edited and another deleted. The send, clear-after-send and draft-report cases now start from notes added this way.
- Mutations: saving empty new notes, an edit that keeps the old note, a delete that keeps only the deleted note,
  a mouseup that never shows the chip, and a chip that loses its quote each turned cases red.
- `src/components/plan-review` specs green; tsc, eslint and the React Compiler bailout check pass.
