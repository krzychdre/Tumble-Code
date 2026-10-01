# Fix: Cloud Auth Expiry (CB-3, CB-4)

**Date:** 2026-07-11
**Branch:** `fix/cloud-auth-expiry`

## Findings

### CB-3 [high] — StaticTokenAuthService never checks JWT expiry

`StaticTokenAuthService` decoded the JWT with `jwtDecode` (no signature
verification, just decode) but never inspected the `exp` claim.
`isAuthenticated()` and `hasActiveSession()` were hardcoded `true`. After
the JWT expired (~1h for Authentik-issued tokens), every cloud API call
401'd, but the service reported authenticated forever and never emitted
`auth-state-changed` — bridge/telemetry/settings retry-failed silently
with no user-visible signal.

### CB-4 [med] — WebAuthService.refreshSession un-awaited clearCredentials()

On `InvalidClientTokenError`, `clearCredentials()` was called without
`await`. If `context.secrets.delete()` rejected, the rejection became an
unhandled rejection in the extension host.

## Fix

### CB-3

In `packages/cloud/src/StaticTokenAuthService.ts`:

1. **Parse `exp` at construction.** The `exp` claim is extracted from the
   decoded JWT payload. If the token is already expired at construction
   time, the service starts in `inactive-session` state (mirroring
   `WebAuthService.transitionToInactiveSession()`).

2. **Schedule an expiry timer.** On `initialize()` (if not already
   expired), a `setTimeout` is scheduled to fire at `exp * 1000` (no
   skew margin — the live re-check handles the boundary). When the timer
   fires, the service transitions to `inactive-session` and emits
   `auth-state-changed` with `{ state: "inactive-session", previousState:
"active-session" }`.

3. **Live re-check in `isAuthenticated()`.** Even if the timer is
   missed/blocked/suppressed, `isAuthenticated()` does a live
   `Date.now() >= exp * 1000` check. If expired, it transitions to
   `inactive-session` on the fly and returns `false`.

4. **Back-compat for non-expiring tokens.** Tokens without an `exp` claim
   (`this.exp === null`) retain the original always-authenticated
   behavior. This preserves dev setups using static non-expiring tokens.

5. **`dispose()` method.** Added to clear the expiry timer. Not part of
   the `AuthService` interface (which has no `dispose`), but available
   for the host to call during teardown.

**State/event names used:**

- State: `"inactive-session"` (from `AuthState` in `@roo-code/types`)
- Event: `"auth-state-changed"` with `{ state: "inactive-session",
previousState: "active-session" }`

**Timer design:**

- `setTimeout` at `exp * 1000 - Date.now()` ms (fires at expiry instant)
- Cleared on `dispose()` and on `transitionToInactiveSession()`
- Live re-check in `isAuthenticated()` as backstop

### CB-4

In `packages/cloud/src/WebAuthService.ts`, line ~453:

```ts
// Before (bug):
this.clearCredentials()

// After (fix):
await this.clearCredentials()
```

The enclosing `refreshSession()` is already `async`, so the `await` is
the minimal change.

## Tests

### CB-3 tests (StaticTokenAuthService.spec.ts)

- **Already-expired JWT at construction** — state is `inactive-session`,
  `isAuthenticated()` === false.
- **Future-expiry JWT** — authenticated now; advance fake timers past
  expiry — transition to `inactive-session` AND `auth-state-changed`
  emitted once.
- **No-`exp` token** — always authenticated (back-compat), even after
  advancing timers far into the future.
- **Live re-check with suppressed timer** — advance system time past
  `exp` without advancing fake timers — `isAuthenticated()` still
  returns false and transitions state.
- **Dispose clears timer** — after `dispose()`, advancing timers does
  not trigger any transition.

### CB-4 test (WebAuthService.spec.ts)

- Mock `context.secrets.delete` to reject; trigger `refreshSession`
  `InvalidClientTokenError` path; assert no `unhandledRejection` event
  is captured via `process.on("unhandledRejection")` hook.
- **Pre-fix verification:** The test FAILS pre-fix (confirmed by
  temporarily reverting the `await` — vitest captures the unhandled
  rejection: `expected [Error: Secret storage delete failed] to have
length 0 but got 1`).

## Verification

- `npx vitest run` (full package): 287 tests, all passing.
- `npx tsc --noEmit`: zero errors.
- CB-4 test confirmed to FAIL pre-fix and PASS post-fix.

## Files Changed

- `packages/cloud/src/StaticTokenAuthService.ts` — CB-3 fix
- `packages/cloud/src/WebAuthService.ts` — CB-4 fix
- `packages/cloud/src/__tests__/StaticTokenAuthService.spec.ts` — CB-3 tests
- `packages/cloud/src/__tests__/WebAuthService.spec.ts` — CB-4 test
