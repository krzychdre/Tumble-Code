# R4 C6: drop the always-false `continueSession` from the CLI TUI

- **Status:** done
- **Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item C6)

## Touched files

- `apps/cli/src/ui/hooks/useExtensionHost.ts`
- `apps/cli/src/ui/App.tsx`
- `apps/cli/src/commands/cli/run.ts`

## Problem

`run()` resolves `--continue` into `initialSessionId` before it renders the TUI and passes `continueSession: false`
unconditionally. The `continueSession` prop of `App` and `useExtensionHost`, the "most recent task of this
workspace" lookup (`getMostRecentTaskId`) and the "No previous tasks found" error were unreachable. The hook also
returned `isReady: isReadyRef.current`, a value frozen inside `useMemo` that no caller read.

## Change

- `useExtensionHost` resumes only `initialSessionId`: wait for the task history, reject an unknown id, open the task.
- `continueSession`, `getMostRecentTaskId`, `isReadyRef` and the `isReady` return field are removed.

## Tests

- `npx vitest run src/ui/hooks/__tests__/useExtensionHost.test.tsx src/ui/__tests__ --maxWorkers=2`: green.
- `tsc --noEmit` for `apps/cli`, eslint on the touched files, `pnpm knip`: clean.
- No new spec: the change removes unreachable code and keeps the `--session` path as it was.
