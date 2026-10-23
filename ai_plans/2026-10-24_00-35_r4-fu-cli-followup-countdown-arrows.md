# r4 follow-up: CLI test for the follow-up countdown cancelled by an arrow key

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during execution")

## Touched files

- `apps/cli/src/ui/__tests__/App.characterization.test.tsx`

## Problem

In allow mode a follow-up question with suggestions starts a 60 s countdown that answers with the first
suggestion. Pressing the up or down arrow stops it; that wiring is a `useInput` handler in `App.tsx` that calls
`cancelCountdown()`. No CLI test drove it, so deleting the call (or either arrow) left every test green.

## Change

Two cases (up and down arrow) in the App characterization spec, which already renders the whole `App` through
the fake extension host: a follow-up ask arrives in allow mode, the countdown line shows, the arrow is pressed,
the full countdown time passes, and the line is gone and no `askResponse` was sent. `App` is the lowest layer:
the handler lives there, and the hook spec only covers the hook's own `cancelCountdown`.

## Tests

- `npx vitest run src/ui/__tests__/App.characterization.test.tsx`: 12 passed, snapshots unchanged.
- Mutations: removing `cancelCountdown()` from the arrow handler fails both cases (the first suggestion is
  auto-sent); dropping `key.upArrow` fails the up case, dropping `key.downArrow` the down case.
