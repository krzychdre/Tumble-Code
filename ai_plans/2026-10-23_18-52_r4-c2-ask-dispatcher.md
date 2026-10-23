# R4 C2: AskDispatcher with one yes/no helper and one exit rule

- **Status:** done
- **Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item C2)

## Touched files

- `apps/cli/src/agent/ask-dispatcher.ts`
- specs: `apps/cli/src/agent/__tests__/ask-dispatcher.test.ts`, `apps/cli/src/agent/__tests__/extension-host.test.ts`

## Problem

- The block "prompt yes/no, send the answer, on a failed prompt print `[Defaulting to: no]` and send no" was copied
  eight times.
- Every handler returned an `AskHandleResult` that the only caller (`extension-host.ts`, the `waitingForInput`
  listener) ignored; `isHandled()` had no callers; every handler took an unused `ts`; `handleResumableAsk` and
  `handleNonBlockingAsk` only forwarded.
- Two rules for one event: with `exitOnError` the dispatcher called `process.exit(1)` on `api_req_failed`. Its
  listener runs before the host's own rule in `waitForTaskCompletion` (which rejects `runTask` for that ask when
  `exitOnError` or `exitOnApiRequestFailed` is set), so in print mode the host was never disposed.

## Change

- `askYesNo(question)` is the one prompt helper; handlers return `void` and take no `ts`.
- The mistake-limit and auto-approval-limit handlers are one `handleLimitReached(title, question, text)`; the
  unknown-ask approval is inlined into `handleUnknownAsk`.
- With `exitOnError` the dispatcher prints the error and leaves the ask to the host: `runTask` rejects, `run.ts`
  disposes the host and exits with code 1 ("[CLI] Error: API request failed: ...").
- Printed text and sent responses are otherwise unchanged.

## Tests

- New: `extension-host.test.ts` "rejects runTask with --exit-on-error in print mode, without exiting on its own"
  (the dispatcher is active there) and `ask-dispatcher.test.ts` "leaves the ask to the host".
- Mutations: putting `process.exit(1)` back turns both red; `askYesNo` sending yes regardless turns "names the
  resource URI" red; restored.
- `npx vitest run` on `ask-dispatcher`, `extension-host`, `print-and-json-output.characterization`, `run.test.ts`:
  green. `tsc --noEmit`, eslint, `pnpm knip`: clean.
