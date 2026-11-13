# R4-B8e: one error report for a failed OpenRouter request

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B8e).

## Touched files

- `src/api/providers/openrouter.ts`
- `src/api/providers/__tests__/openrouter.spec.ts`

## Problem

`createMessage` and `completePromptWithUsage` caught a rejected `chat.completions.create` with the same 30 lines: parse
the OpenRouter error shape, prefer the upstream provider's message from `metadata.raw`, report an `ApiProviderError`
to telemetry (with code and status for the OpenRouter shape, plain otherwise), and rethrow through
`handleProviderError` (jscpd: 346-361 against 464-479).

## Change

One private `reportRequestError(error, modelId, operation)` does the parse and the telemetry report and returns the
error to throw; both catch blocks are `throw this.reportRequestError(error, modelId, "<operation>")`. No behaviour
change.

## Tests

- New in `openrouter.spec.ts`: one case per path (`createMessage`, `completePrompt`) for a rejected request in the
  OpenRouter shape: telemetry gets the message from `metadata.raw`, the code as `errorCode` and `status`, and the
  path's operation. Nothing covered the rejected OpenRouter shape on `completePrompt` or `metadata.raw` before; the
  cases pass against the previous `openrouter.ts` as well.
- Mutation checks: ignoring `metadata.raw` fails both new cases; reporting every OpenRouter-shape error as
  `createMessage` fails the `completePrompt` case.
