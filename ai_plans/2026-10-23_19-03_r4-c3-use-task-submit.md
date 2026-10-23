# R4 C3: useTaskSubmit with non-null host members and a command table

- **Status:** done
- **Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item C3)

## Touched files

- `apps/cli/src/ui/hooks/useTaskSubmit.ts`, `apps/cli/src/ui/hooks/useExtensionHost.ts` (return types)
- `apps/cli/src/ui/hooks/__tests__/useTaskSubmit.test.tsx`

## Problem

`sendToExtension`, `runTask`, `switchModel` and `cloudAuth` were typed `| null` (or optional), but
`useExtensionHost` always returns stable functions and App always passes them, so seven guards never fired (the
"not available until the extension has started" notes included). `handleSubmit` was a 190-line callback with 25
dependencies; `trimmedText.slice(commandMatch[0].length).trim()` appeared five times; three system messages were
spelled with `addMessage` instead of `note`; `handleApprove` and `handleReject` differed only in the response.

## Change

- The four members are required and non-null (also in `UseExtensionHostReturn`).
- `handleSubmit` parses the command and its argument once and calls `commandHandlers[action](argument)`, a
  `Record<GlobalCommandAction, ...>` (a new command must add its handler or the build fails). The task path is
  `sendUserMessage`; `/model` and `/permissions` are `runModelCommand` and `setPermissions`.
- `answerApproval(response)` backs `handleApprove` and `handleReject`.

## Tests

- Harnesses pass an `idleHost` (a throwing `switchModel`, an idle channel); the spec for the null channel is gone.
- New: "handleApprove / handleReject answers the ask with ..." (parametrized).
- Mutations: `copyLastAnswer: exportTranscript` turns 3 specs red; never matching a command turns 27 red;
  `handleReject` sending yes turns the new spec red; restored.
- `npx vitest run src/ui --maxWorkers=2`: green. `tsc --noEmit`, eslint, `pnpm knip`: clean.
