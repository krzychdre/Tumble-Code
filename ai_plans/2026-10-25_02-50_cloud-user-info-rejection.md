# Cloud sign-in: a failed user-info request became an unhandled rejection

**Status:** fixed on branch `fix/cloud-user-info-rejection`
**Related plans:** `2026-10-25_00-26_test-refactor-round-5.md` (lane L8 spotted it while pruning the cloud specs)
**Touched:** `packages/cloud/src/WebAuthService.ts`, `packages/cloud/src/__tests__/WebAuthService.spec.ts`,
`.changeset/cloud-user-info-rejection.md`

## Symptom

A CLI signed in to a Tumble Code Cloud could exit with code 1 in the middle of a task when the cloud came back
after an outage: the session refresh succeeded, but the user-info request (`/v1/me`) failed (5xx, network error,
10 s timeout or an unexpected body).

## What was happening

`WebAuthService.refreshSession` starts `fetchUserInfo()` without waiting for it when the session turns active.
`clerkMe` throws on any non-2xx answer, so a failure rejected a promise nobody handled. The CLI's process guards
(`apps/cli/src/lib/process-guards.ts`) treat an unhandled rejection as fatal and exit with code 1; the VS Code
extension host only logs it.

## Fix

The background call keeps running without blocking the session, and its failure is caught and logged
(`[auth] Failed to fetch user info`).

## Tests

`session refresh > stays active and logs when the user info cannot be read, without an unhandled rejection`:
`/v1/me` answers 502; the session must be active, the failure logged, and no `unhandledRejection` raised. Red before
the fix, green after (46 tests in the spec).
