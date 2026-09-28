# P9: commands and webview no longer wait for the cloud at activation

Roadmap item: `ai_plans/2026-09-27_simplification-roadmap.md`, **P9**.

> Problem: "`registerCommands` runs after `CloudService.createInstance` and settings import are awaited; a slow
> cloud delays every command."
> Fix: "Register commands and the webview right after `ContextProxy`; start the cloud in the background with a
> timeout."

Branch: `perf/p9-activation-before-cloud` (off main @ 6f1e86c9f).

## 1. Evidence (verified on main @ 6f1e86c9f)

`activate()` in `src/extension.ts`, in the order it runs:

| Line | Step                                               | Awaited |
| ---- | -------------------------------------------------- | ------- |
| 197  | `MdmService.createInstance` (local file)           | yes     |
| 216  | `ContextProxy.getInstance`                         | yes     |
| 265  | `new ClineProvider(...)`                           | -       |
| 286  | `CloudService.createInstance(...)`                 | **yes** |
| 317  | `provider.initializeCloudProfileSyncWhenReady()`   | **yes** |
| 328  | `registerWebviewViewProvider` (the sidebar)        | -       |
| 334  | `checkWorktreeAutoOpen`                            | yes     |
| 338  | `autoImportSettings` (settings import from a file) | yes     |
| 349  | `registerCommands`                                 | -       |
| 393  | `activationCompleted` command                      | -       |
| 454  | `setupRemoteControlBridge`                         | -       |

So the claim holds: every command and the sidebar wait for the cloud start and for the profile sync after it;
the commands also wait for the settings import.

What the cloud start actually waits for today (`packages/cloud`): `CloudService.createInstance` (:390) awaits
`initialize()` (:403), which awaits `WebAuthService.initialize()` (:131) and `CloudSettingsService.initialize()`
(:139). No network request is awaited there: the auth service reads the stored credentials with
`context.secrets.get` (`WebAuthService.ts` :219) and starts a refresh timer; the settings service reads its cache.
The slow part in practice is the secret storage, i.e. the OS keyring (libsecret / gnome-keyring on Linux,
Keychain on macOS), which can take seconds or wait on an unlock prompt. The design below does not depend on
which step is slow.

Failing tests on main (commit 1):

- `src/__tests__/extension.spec.ts` "registers the commands and the sidebar webview while the cloud is still
  starting": `createInstance` returns a promise that never resolves; `activate()` is still pending after 1 s,
  `registerCommands` was never called.
- same file, "wires profile sync, state push, cleanup and the bridge once a late cloud start finishes": same
  stall on main; after the fix it pins what must happen when the start finishes late.
- `packages/cloud/src/__tests__/CloudService.test.ts` "isEnabled while the instance is still initializing":
  `CloudService.isEnabled()` (:432) throws `CloudService not initialized.` in that window, because it checks
  `_instance` (set before `initialize()` runs) instead of `hasInstance()`. Latent on main (no task can run before
  the cloud is up), but `TaskMessageLog` calls it for every chat message, so the reorder would expose it.

## 2. Design

New module `src/extension/cloudStartup.ts` (no imports, so any layer may use it):

- `startCloudInBackground(start, log, timeoutMs = 10_000)` runs `start` without blocking, logs a rejection instead
  of rethrowing, returns a promise that resolves when `start` settles. At the timeout it logs
  `[CloudService] still starting after 10 s; ...` and releases waiters. The timeout cancels nothing (a cloud
  start cannot be cancelled); a late finish still runs its continuation.
- `isCloudStartPending()`: true until the start settles or the timeout passes.
- `waitForCloudStart()`: resolves when the start settles or the timeout passes; at once if none was started.

`activate()` order after the change:

1. unchanged up to `new ClineProvider(...)`;
2. `startCloudInBackground(...)` with the old cloud block moved inside it verbatim (createInstance, telemetry
   client registration, `context.subscriptions.push(cloudService)`, local-only fallback), then the cloud profile
   sync, then a state push to the visible webview;
3. `TelemetryService.setProvider`, `registerWebviewViewProvider`, **`registerCommands`**;
4. worktree auto-open and settings auto-import (still awaited, now after the commands);
5. the rest unchanged (diff content provider, URI handler, code actions, `activationCompleted`, API object);
6. `setupRemoteControlBridge` runs in `cloudStart.then(...)`, because it subscribes to the cloud session only when
   `CloudService.hasInstance()` is true at setup time.

Readers that can now run before the cloud is up:

| Reader                                                                         | Before the start settles                                                  | Change                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ProviderStateBuilder.readCloudFacts` / `getCloudOrganizations`                | each read is in try/catch, signed-out defaults                            | none; activation pushes fresh state when the start settles                                             |
| `CloudProfileSync.initializeWhenReady` (provider constructor)                  | guarded by `hasInstance()`, deferred                                      | none; activation calls it again after the start (as before)                                            |
| `TaskMessageLog` via `CloudService.isEnabled()`                                | threw                                                                     | `isEnabled()` now `hasInstance() && isAuthenticated()`                                                 |
| `MdmService.isCompliant`                                                       | `hasInstance()` false, so non-compliant under a `requireCloudAuth` policy | the account-tab redirect is held back while `isCloudStartPending()`; the post-start state push runs it |
| `handleUri` `/auth/clerk/callback`                                             | `CloudService.instance.handleAuthCallback` would throw "not initialized"  | awaits `waitForCloudStart()` first (bounded by the timeout)                                            |
| webview `cloudAuth` handlers (login, logout, share, switch org)                | each in try/catch, shows the error                                        | none (user actions; the window is short)                                                               |
| `MarketplaceManager`, `ClineProvider` logout / telemetry props, bridge helpers | guarded by `hasInstance()`                                                | none                                                                                                   |
| `deactivate()`                                                                 | guarded by `cloudService && hasInstance()`                                | none                                                                                                   |

Other hosts: `apps/cli/src/agent/extension-host.ts` :474 awaits the same `activate()` and then waits for the
webview-ready flag; it has no direct cloud dependency, so it only gets faster.

## 3. Invariants

- `activate()` never rejects because of the cloud and never waits for it.
- Every step of the old cloud block still runs, in the same order, with the same log lines (the em dash in the
  local-only line became a hyphen).
- The profile sync still runs after `createInstance` settles; the bridge is still set up with the same arguments.
- `CloudService.hasInstance()` keeps its meaning (created and initialized).

## 4. Tests

- `src/__tests__/extension.spec.ts`: the two P9 cases above; the local-only case waits for its log line.
- `src/extension/__tests__/cloudStartup.spec.ts`: pending/settled, rejection logged, timeout releases waiters and
  a late finish still completes, no timeout log after an early settle.
- `src/activate/__tests__/handleUri.spec.ts`: the Clerk callback waits for a pending start and goes through at
  once after it.
- `src/core/webview/__tests__/ClineProvider.spec.ts`: MDM redirect held back while pending, sent after.
- `packages/cloud/src/__tests__/CloudService.test.ts`: `isEnabled()` false (not a throw) while initializing.

The handleUri and MDM cases were checked against the product code with the new line removed: both fail.

## 5. Residuals

- Cloud-agent runs (static `ROO_CODE_CLOUD_TOKEN`): chat messages added before the start settles are not captured
  by `TaskMessageLog` (`isEnabled()` is false then). The static-token start has no keyring read and settles in a
  few microtasks, and the CLI waits for the webview-ready flag after `activate()`, so no message is expected in
  that window; not measured.
- Telemetry events captured before the cloud telemetry client registers go to PostHog only (same as before for
  events emitted before line 286).
- `readCloudFacts` logs one `console.error` per cloud fact per state push during the start window (the same noise
  local-only mode already produces).
- If the extension is deactivated while the start is still pending, `cloudService` is pushed to
  `context.subscriptions` after disposal and never disposed. Only a keyring stall across a window reload hits it.
- `autoImportSettings` stays awaited before `activationCompleted` and the API return, so other extensions still
  see the imported settings; a command run during the import sees the settings from before it.
