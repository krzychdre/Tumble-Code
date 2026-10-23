# R4 D4 (CLI bullet): App.tsx small cleanups

- **Status:** done
- **Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item D4, the `apps/cli/src/ui/App.tsx`
  bullet)

## Touched files

- `apps/cli/src/ui/App.tsx`
- `apps/cli/src/ui/__tests__/App.characterization.test.tsx`

## Problem

`showFollowupSuggestions` re-derived `showFollowupDialog` (the same follow-up-with-suggestions condition without
the secret-prompt check); `hasStartedTask` was read from the store as `_hasStartedTask` and never used;
`currentMode || mode` was spelled four times.

## Change

- The arrow-key countdown cancel uses `showFollowupDialog`. While a command's password prompt is up the dialog is
  hidden, so arrows there no longer cancel the follow-up countdown (the prompt owns the keys).
- `_hasStartedTask` is gone; `activeMode` names the mode the extension reports, else the startup mode.

## Tests

- New: "shows the mode the extension reports, not the one the session started in".
- Mutation: `activeMode = mode` turns it red; restored.
- `npx vitest run src/ui/__tests__ src/ui/hooks --maxWorkers=2`: green. `tsc --noEmit`, eslint, `pnpm knip`: clean.
