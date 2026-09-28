# UI plan §4 (CLI), part 3: cloud and bridge status with an offline marker

Source: `ai_plans/2026-09-27_ui-modernization.md` §4, bullet "A status line showing the cloud or bridge connection and
an offline marker". Branch `feat/ui-4-cli-status-line`, stacked on `feat/ui-4-cli-doctor`.

## What existed (verified)

- The CLI footer (`apps/cli/src/ui/components/input/InputFooter.tsx`) shows hint, mode, model, context gauge, cost.
- The state push carries `cloudIsAuthenticated`, `cloudUserInfo`, `cloudApiUrl`, but nothing about the bridge.
- The bridge (`src/extension/bridge.ts`, `packages/cloud/src/bridge/BridgeOrchestrator.ts`) runs in the CLI too (the
  CLI hosts the whole extension, `extension.ts` calls `setupRemoteControlBridge` after the cloud start) but only logs
  its connection (`isConnected` is a getter nobody reads, no event).

So the CLI had no way to know the bridge state; the extension had to report it.

## Change

- Types: `RemoteControlStatus = "off" | "connecting" | "connected" | "offline"`, `ExtensionState.remoteControlStatus`.
  Always sent explicitly ("off" rather than undefined) because postMessage drops undefined keys and the webview
  merges pushes.
- `BridgeOrchestrator`: `onStatusChange` option and a `status` getter. `connecting` at start and after a drop
  socket.io retries (`socket.active`), `connected` on connect, `offline` on any `connect_error` (even while socket.io
  keeps retrying, because the user cannot share or be remote-controlled meanwhile), on a drop it will not retry and on
  `reconnect_failed`. Reported once per change.
- `src/extension/remoteControlStatus.ts`: the module-level status (no vscode import, so the state builder can read it
  without loading the bridge wiring). `bridge.ts` sets it (`connecting` on start, `offline` while a failed start waits
  for its retry, `off` on stop / sign-out) and pushes state on each change; the push is guarded so it never throws out
  of a socket or auth listener.
- `ProviderStateBuilder` adds `remoteControlStatus` to the webview push (golden snapshots updated: one key, `"off"`).
- CLI: the reducer emits `setCloudStatus` only for pushes that carry `cloudIsAuthenticated` (single-field pushes such
  as `storageErrorMessage` must not reset it); the store keeps `cloudStatus` across both resets and skips an equal
  status; the footer shows, before the mode: nothing when signed out (the normal local run), `● cloud` connected,
  `○ cloud connecting`, `○ cloud offline` in the warning colour, `○ cloud` while the bridge has not started.

## Deviation from the test commit

The first commit expected `getRemoteControlStatus()` to be `undefined` after sign-out; the implementation uses an
explicit `"off"` (see the postMessage note above), and the fix commit updates that one expectation.

## Tests

- `BridgeOrchestrator.rearm.spec.ts` (+5): connecting/connected, offline after `connect_error`, retry vs final drop,
  `reconnect_failed`, one report per change. Cloud bridge specs: 35 passed.
- `src/extension/__tests__/bridge.spec.ts` (+3): follows the orchestrator and pushes state, offline while a failed start
  waits, off after sign-out. 6 passed. `ClineProvider.stateBuilder.spec.ts`: 19 passed, 3 golden snapshots updated.
- CLI: reducer (+1), store (+1), footer (+5); with App characterization, transcript sink and reader: 140 passed.

## Residuals

- No live check against a signed-in cloud (no cloud session on this host); the footer is covered by ink renders.
- The webview does not show the status yet; the field is there if it wants to.
