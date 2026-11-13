# r4 A4g follow-up: serialize-error 13 with unchanged error texts

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item A4g, deferred part)

## Touched files

- `src/package.json`, `pnpm-lock.yaml` (`serialize-error` ^13.0.2)
- `src/utils/errors.ts` (`serializeThrown`)
- `src/core/assistant-message/toolCallbacks.ts`, `src/core/task/RetryHandler.ts`,
  `src/services/code-index/shared/validation-helpers.ts` (call sites)
- `src/core/task/Task.ts` (unused `serializeError` import removed)
- specs: `toolCallbacks.spec.ts`, `RetryHandler.error-shapes.spec.ts`, `validation-helpers.spec.ts`

## Problem

serialize-error 13 turns a non-object value into a `NonError` whose message is `Non-error value: <value>`; 12
returned it unchanged. Four texts we build from a caught value would change for a thrown string (or `null`):

1. the tool error the model reads (`describeToolErrorForModel`): `"disk on fire"` would become
   `{"name":"NonError","message":"Non-error value: disk on fire"}`;
2. the tool error shown in the chat (`handleError`, `say("error", ...)`);
3. the failed API request text (`apiErrorDisplayText` in `RetryHandler`);
4. the embedder validation error (`handleValidationError`): `"boom"` would become `Non-error value: boom`, and
   `null` would show `Non-error value: null` instead of the generic configuration error.

## Change

`serializeThrown(value)` in `src/utils/errors.ts` calls `serializeError` for an object and returns any other value
unchanged, which is exactly what serialize-error 12 did. The three files call it instead of `serializeError`.
Objects and `Error`s go through serialize-error as before.

## Tests

- New cases: a thrown string in `handleError` (model text and chat text), a thrown string in
  `handleApiRequestError`, a thrown string and `null` in `handleValidationError`. All four fail on serialize-error
  13 with the plain `serializeError` calls (the received texts carry `Non-error value`) and pass with
  `serializeThrown`.
- Mutation: dropping `value !== null` from `serializeThrown` turns the `null` case red.
- The existing cases of the three specs pass unchanged (47 in total).
- `tsc --noEmit` and eslint for `src`, `pnpm knip`, extension bundle builds.
