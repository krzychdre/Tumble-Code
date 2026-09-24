# Zoo #1458 port: number chat message snapshots in the order they are read

**Status:** ported (one commit on wip/zoo-agent-c)
**Upstream:** Zoo-Code PR #1458, commit cd09db10e, merged 2026-08-31 (author Roomote)
**Touched:** src/core/webview/ClineProvider.ts, src/core/webview/__tests__/ClineProvider.spec.ts

## Symptom

While a child task starts, the chat view can jump back to Home: an older state push (built
before the child had any messages) reaches the webview after a newer one and replaces the
child's messages with an empty list.

## Root cause in our code

`getStateToPostToWebview()` reads `currentTask.clineMessages` part-way through
(`ClineProvider.ts` around line 2806) and then still awaits `openAiCodexOAuthManager.isAuthenticated()`
(around line 2925). `postStateToWebview()` and `postStateToWebviewWithoutTaskHistory()` only
incremented `clineMessagesSeq` after the whole build resolved (lines 2443-2444 and 2469-2470).
So when two pushes overlap and the one that read the messages first finishes last, it gets the
higher number, and the webview's stale-state guard (`ExtensionStateContext.tsx:183-189`, which
applies clineMessages only for a strictly higher number) accepts the older snapshot.

## Fix

Zoo takes the number at the start of each post method. That still mis-orders two builds whose
reads happen in the opposite order to their starts (their awaits before the read, such as the
cloud organisation fetch, can finish in any order). This port stamps the number inside
`getStateToPostToWebview()`, in the same synchronous step as the `clineMessages` read, so the
number always follows the age of the snapshot. The post methods no longer increment it.
`postStateToWebviewWithoutClineMessages()` now also drops the number, so a push without
messages cannot raise the webview's high-water mark. The customModePrompts path in
`webviewMessageHandler.ts` also posts this state, so it now gets a number (and the guard) too.

## Tests

`ClineProvider.spec.ts`: a new `test.each` over both post methods holds the first build open on
`isAuthenticated` after it has read an empty message list, completes a newer push with a message,
then releases the first one. Before the fix both cases failed with
`expected 2 to be less than 1` (the stale snapshot got the higher number). Plus a guard case that
`postStateToWebviewWithoutClineMessages` posts no number. After: ClineProvider.spec.ts 93/93;
`src/core/webview` 386/386 (30 files); src tsc clean; eslint clean.

## Not ported

- Zoo's test fixtures that mock `getStateToPostToWebview` wholesale: our stamp lives inside that
  method, so the new test drives the real builder instead.
