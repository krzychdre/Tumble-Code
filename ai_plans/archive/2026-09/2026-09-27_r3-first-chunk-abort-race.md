# R3: one abort race for the first chunk and every later one

Item R3 of `2026-09-27_simplification-roadmap.md`.

## Problem

`TaskApiLoop.attemptApiRequest` awaited the first stream chunk with a hand-written `Promise.race` against an
abort promise. Its listener was added without `{ once: true }` and never removed, so it stayed on the request's
`AbortSignal` until the stream ended, and the code duplicated `raceNextChunkWithAbort`, which `processStream`
already uses for every later chunk (AP-5). The one-shot logging listener was also registered without `once`.

Correction to the roadmap text: the leftover promise does not cause an unhandled rejection, because
`Promise.race` subscribes to it. The signal is per request, so listeners do not pile up across requests either.
The change is a DRY and cleanup fix, not a crash fix.

## Change

- The first chunk uses `raceNextChunkWithAbort(iterator, abortSignal)`.
- The logging listener is registered with `{ once: true }`.

## Tests

`TaskApiLoop.request-signal.spec.ts`:

- After the first chunk arrives, only the one-shot logging listener remains on the signal. This case fails
  without the fix.
- Cancelling before the first chunk still rejects with "Request cancelled by user" into
  `handleApiRequestError`.
