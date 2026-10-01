# Fix: backend restart forces VS Code re-auth (`CONFIG_SECTION is not defined`)

**Date:** 2026-06-21
**Branch:** `feature/self-hosted-remote-task-control` (the branch that introduced the bridge — this is the bridge's own bug)

## Symptom (user's words)

> "Whenever I restart the backend I need to re-authenticate vscode Tumble code or I
> can't share the task and get: `[TelemetryClient#fetch] Unauthorized: No session
token available.`"

## Root cause (proven with evidence, not assumed)

The extension's own log (`~/.config/Code/logs/.../1-Tumble-Code.log`) shows the exact
chain:

```
[bridge] Failed to set up remote control bridge: CONFIG_SECTION is not defined
[auth] changeState: attempting-session -> active-session
[auth] Failed to refresh session
ReferenceError: CONFIG_SECTION is not defined
    at n (extension.js)                 ← isEnabled()
    at authStateListener                ← bridge reconcile() registered on auth-state-changed
    at changeState
    at refreshSession
[auth] changeState: active-session -> logged-out
```

`src/extension/bridge.ts` references `CONFIG_SECTION` and `CONFIG_KEY`
(lines 35 and 120) but **never defines or imports them**. Every call to
`isEnabled()` throws `ReferenceError`.

`reconcile()` calls `isEnabled()`, and `reconcile` is registered as the
`auth-state-changed` listener (bridge.ts:126). The cloud `WebAuthService` emits
`auth-state-changed` **synchronously** from inside `changeState()`, which runs
inside `refreshSession()`. So when a backend restart makes the refresh timer
re-mint a session token and flip the state to `active-session`, the synchronous
emit invokes the throwing `reconcile`, the `ReferenceError` propagates up through
`emit → changeState → refreshSession`, corrupts the auth state machine, and the
session ends up `logged-out`. Result: **every backend restart logs the user out**,
and `getSessionToken()` then returns nothing → `TelemetryClient` logs
"No session token available" and Share fails.

### Ruled out (with evidence)

- **Server-side token persistence** — NOT the cause. Client tokens live in
  persistent postgres (`stork_code`), never expire (`ClientToken.expires_at` NULL),
  `get_db()` commits. Minted a real client token and hit
  `POST /v1/client/sessions/{id}/tokens` → 200 + JWT. Hammered that endpoint with
  the same token across a `--reload` cycle → **40/40 returned 200**, zero blips.
  The backend recovers seamlessly; the bug is entirely client-side.

## Fix

In `src/extension/bridge.ts`:

1. `import { Package } from "../shared/package"` and define the missing constants:
   `const CONFIG_SECTION = Package.name` (`"tumble-code"`),
   `const CONFIG_KEY = "remoteControlEnabled"`. Matches the existing setting
   `tumble-code.remoteControlEnabled` in `src/package.json` and the
   `getConfiguration(Package.name)` idiom at `src/extension.ts:184`.
2. Harden `reconcile()` to catch and log its own errors, so a future bridge fault
   can never again propagate synchronously into the auth state machine.

## Verification

- `isEnabled()` no longer throws; `reconcile` runs cleanly on auth-state changes.
- Rebuild the extension; confirm the startup log no longer shows
  `[bridge] Failed to set up remote control bridge: CONFIG_SECTION is not defined`,
  and that a backend restart no longer flips auth to `logged-out`.

```

```
