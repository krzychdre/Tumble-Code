# P3 — Deduplicate the `webviewDidLaunch` post

Roadmap item **P3** from `ai_plans/2026-09-27_simplification-roadmap.md`.
Branch: `feature/p3-dedup-webviewdidlaunch` (off `main` @ `d55078ec7`, not stacked on D6/D14).

## Goal

The webview posts the `webviewDidLaunch` message **twice** on startup, once per
mount site. The extension-host handler is not idempotent — every copy triggers a
full `postStateToWebview()` — so startup builds and sends the complete state
(including full task history, per the `forgetWebviewTaskHistory()` reset) twice.
Remove one post so the message is sent exactly once.

## Evidence of the double post (main @ d55078ec7)

Both posts use the same shared constant
[`WEBVIEW_DID_LAUNCH_MESSAGE`](../webview-ui/src/context/webviewDidLaunchMessage.ts:6)
(`{ type: "webviewDidLaunch", acceptsMessageAdded: true }`), so both also
declare the `messageAdded` capability.

1. [`App.tsx:204`](../webview-ui/src/App.tsx:204):

    ```tsx
    // Tell the extension that we are ready to receive messages.
    useEffect(() => vscode.postMessage(WEBVIEW_DID_LAUNCH_MESSAGE), [])
    ```

    Import at [`App.tsx:14`](../webview-ui/src/App.tsx:14).

2. [`ExtensionStateContext.tsx:171-173`](../webview-ui/src/context/ExtensionStateContext.tsx:171):
    ```tsx
    useEffect(() => {
    	vscode.postMessage(WEBVIEW_DID_LAUNCH_MESSAGE)
    }, [])
    ```
    Import at [`ExtensionStateContext.tsx:30`](../webview-ui/src/context/ExtensionStateContext.tsx:30).

`AppWithProviders` ([`App.tsx:339-351`](../webview-ui/src/App.tsx:339)) renders
`ExtensionStateContextProvider` as an ancestor of `App`, so **both** effects run
on startup: the provider's first, the child `App`'s second.

The only other sender is the CLI host
([`apps/cli/src/agent/extension-host.ts:532`](../apps/cli/src/agent/extension-host.ts:532)),
which posts `{ type: "webviewDidLaunch" }` (no flag) into the same handler from
outside the webview — unaffected by this change.

## Host-side behavior on receiving it twice

[`taskLifecycle.ts:14-92`](../src/core/webview/messageHandlers/taskLifecycle.ts:14)
`webviewDidLaunch` handler:

- `forgetWebviewTaskHistory()` (line 20) — resets the remembered history
  revision so the next push must carry the **whole** history.
- `setWebviewAcceptsMessageAdded(...)` (line 21).
- `await getCustomModes()` then `postStateToWebview()` (line 26) — full state
  build + send, with the full task history forced by the reset above.
- plus theme post, MCP list post, `listConfig` promise chain, telemetry update.

There is **no idempotence guard**: two launch messages → two
`forgetWebviewTaskHistory()` + two `postStateToWebview()` full-state sends (and
two `customModes` reads and two config-list chains). This is exactly the
startup cost the roadmap flags. Confirmed by the host test
[`ClineProvider.taskHistory.spec.ts:1604-1612`](../src/core/webview/__tests__/ClineProvider.taskHistory.spec.ts:1604)
("webviewDidLaunch (a reloaded webview) always receives the whole history") —
each launch message unconditionally produces a full push.

Per the task scope, the host handler is left unchanged (it _must_ remain
non-idempotent for genuine webview reloads — a reloaded webview needs the full
state again). The fix is webview-side: post once.

## Which post stays and why

**Keep the provider's copy** ([`ExtensionStateContext.tsx:171-173`](../webview-ui/src/context/ExtensionStateContext.tsx:171)),
**remove the `App.tsx` one** (line 204 + import line 14). Reasons:

- The roadmap note says "Keep the provider's copy."
- The provider mounts **before** `App` (ancestor), so its post is the first
  message the host sees; the host's full-state response is then processable by
  the provider's `useAnyExtensionMessage` subscription, which is what hydrates
  state. Nothing in `App` depends on having posted the launch itself — `App`
  only consumes hydrated state (`didHydrateState`).
- The provider copy is the one already pinned by an existing test:
  [`ExtensionStateContext.messages.spec.tsx:113-114`](../webview-ui/src/context/__tests__/ExtensionStateContext.messages.spec.tsx:113)
  asserts the launch post as the provider's first outgoing message.
- Removing the provider's copy instead would make the launch depend on `App`
  mounting, which is gated behind `ErrorBoundary`/providers and would arrive
  strictly later — no benefit, and it would orphan the provider test.

## How behavior is proven unchanged

The message content is identical (same constant), the sender timing only loses
the redundant second copy, and the remaining post fires earlier (or equal) than
the removed one (provider mounts first). TDD proof at the lowest layer that can
represent the double post:

1. **Red**: a new case in the webview-ui `App.spec.tsx` harness asserting that
   rendering `AppWithProviders` posts `webviewDidLaunch` exactly once. With the
   duplicate still on main, it counts **2** posts → fails red.
2. **Green**: after removing the `App.tsx` post → exactly **1** post.

The existing `App.spec.tsx` mocks `ExtensionStateContextProvider` as a
pass-through, so it observes only `App`'s own post; the new test therefore
un-mocks the provider (or counts via the real provider) to capture both sites.
The existing provider-level assertion
(`ExtensionStateContext.messages.spec.tsx`) keeps guarding the surviving copy.

## Verification commands

```sh
cd webview-ui && npx vitest run src/__tests__/App.spec.tsx src/context/__tests__/ExtensionStateContext.messages.spec.tsx
cd webview-ui && pnpm run check-types
cd webview-ui && pnpm run lint
pnpm knip   # no NEW findings vs the pre-existing exit-1 baseline
```

## Acceptance criteria

- [x] `webviewDidLaunch` posted exactly once per webview startup (provider copy).
- [x] Host handler untouched; CLI launch path untouched.
- [x] New regression test: red (2 posts) on main behavior → green (1 post).
- [x] Existing provider message-table tests still pass.
- [x] check-types, lint, vitest green; knip no new findings.
- [x] Changeset: patch for `@roo-code/vscode-webview`.
- [x] Committed on `feature/p3-dedup-webviewdidlaunch`, not pushed.
