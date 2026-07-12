# Fix: Cloud Degradation Signals

**Branch:** `fix/cloud-degradation-signals`
**Date:** 2026-07-12

## Problem

Two issues that make cloud-layer failures invisible or fatal:

1. **BridgeOrchestrator has no error-path socket listeners** — when auth refresh
   fails repeatedly, socket.io reconnect-loops silently. Nothing in the logs tells
   the user why remote control is dead.

2. **CloudService.createInstance failure kills whole-extension activation** — a
   throwing `WebAuthService.initialize()` (bad backend URL, corrupted credentials)
   fails `activate()` entirely; the user loses the whole extension because the
   optional cloud layer broke.

## Fix 1: BridgeOrchestrator error-path listeners

**File:** `packages/cloud/src/bridge/BridgeOrchestrator.ts`

Added three listeners:

- `socket.on("connect_error", ...)` — logs the error message + classifies it as
  auth-shaped (token/auth/unauthorized/401/403) or network/server.
- `socket.io.on("reconnect_attempt", n => ...)` — manager-level; logs attempt #1
  and every 5th attempt (throttling to avoid log spam during long outages).
- `socket.io.on("reconnect_failed", ...)` — logs when the manager gives up.

Counter (`reconnectAttempt`) is reset to 0 on successful `connect`.

Cleanup: `stop()` now also calls `socket.io.removeAllListeners()` before
`socket.removeAllListeners()` and `disconnect()`.

### Throttling scheme

- Attempt 1: logged
- Attempts 2-4: NOT logged
- Attempt 5: logged
- Attempt 6-9: NOT logged
- Attempt 10: logged
- ... (every 5th)
- `reconnect_failed`: always logged (terminal event)

## Fix 2: Extension activation survives CloudService init failure

**File:** `src/extension.ts`

Wrapped the entire cloud-init block (`createInstance` + telemetry registration +
`context.subscriptions.push`) in try/catch. On failure:

- `cloudService` is set to `undefined`
- Logs `[CloudService] initialization failed — continuing in local-only mode: <error>`
- Activation continues; provider, commands, webview all register normally

`provider.initializeCloudProfileSyncWhenReady()` is called outside the try/catch
because it internally guards with `CloudService.hasInstance()`.

### Downstream CloudService.instance assumptions

`CloudService.instance` throws `"CloudService not initialized"` when no instance
exists. `CloudService.hasInstance()` returns `false` when `_instance` is null or
not initialized.

ClineProvider usages of `CloudService.instance` (without `hasInstance()` guard):

- Lines 2253, 2462, 2472, 2482, 2492, 2502, 2525 — all inside try/catch blocks
  within `getState()`. They will catch the "not initialized" error and return
  defaults. **Acceptable for degraded path.**

The `deactivate()` function already guards with `if (cloudService && CloudService.hasInstance())`.

### Residual risks

- `CloudService.instance` calls in `ClineProvider.getState()` (lines 2253, 2462,
  etc.) will throw "not initialized" on every state refresh in local-only mode.
  They're caught, but will produce console.error noise. Not a crash risk.
- If `createInstance` partially succeeds (sets `_instance` but `initialize()`
  throws), `CloudService.hasInstance()` returns `false` (checks `isInitialized`),
  so callers will correctly skip cloud features. `_instance` remains set but
  unusable — `resetInstance()` would clean it up, but nothing calls it in this
  path. Low risk: the next `activate()` would hit "instance already created".

## Tests

### BridgeOrchestrator (`packages/cloud/src/bridge/__tests__/BridgeOrchestrator.test.ts`)

5 new tests:

- `logs connect_error with auth/network classification`
- `logs reconnect_attempt #1 and every 5th, skips 2-4`
- `logs reconnect_failed when manager gives up`
- `cleans up manager-level listeners on stop()`
- `resets reconnect counter on successful connect`

FakeEmitter updated: added lazy `io` getter (stands in for socket.io Manager)
to avoid infinite recursion in constructor.

### Extension (`src/__tests__/extension.spec.ts`)

1 new test:

- `continues activation in local-only mode when CloudService.createInstance rejects`

Mock context updated: added `globalStorageUri` and `storageUri` (were missing,
causing pre-existing tests to fail at `initMemoryPaths`).
CloudService mock: `createInstance` now returns `mockResolvedValue` by default.

## Verification

- `packages/cloud`: 299 tests pass, `tsc --noEmit` zero errors.
- `src`: 3 extension tests pass, `tsc --noEmit` only pre-existing `zai.ts:129`.
