# Drop the "Enjoying Tumble? Check out Tumble Code Cloud" home-screen upsell

**Status:** done (branch `fix/drop-cloud-task-list-upsell`)
**Follows:** `2026-09-29_11-38_drop-cloud-long-running-upsell.md` (#648), which reworded this banner
but kept it.
**Touched:**

- `webview-ui/src/components/chat/ChatView.tsx`
- `webview-ui/src/components/chat/WarningRow.tsx`
- `webview-ui/src/components/common/DismissibleUpsell.tsx` (deleted) and its spec (deleted)
- `webview-ui/src/components/chat/__tests__/ChatView*.spec.tsx`, `TaskHeader.spec.tsx`
- `webview-ui/src/i18n/locales/*/cloud.json` (18 locales)

## Symptom

On the home screen of a signed-out user with 6 or more tasks in history, a banner showed under the
task list:

> Enjoying Tumble? Check out Tumble Code Cloud: follow and control your tasks from anywhere, get
> usage stats and more. Learn more.

The owner does not want the extension to advertise the cloud at all.

## Fix

- `ChatView` no longer renders the `taskList2` upsell. Everything that existed only for it went
  with it: the `useCloudUpsell` call, the `CloudUpsellDialog` it opened, the `cloudIsAuthenticated`
  selector, and the `Trans`, `Link` and `Cloud` imports. The Share button keeps its own
  `useCloudUpsell` + `CloudUpsellDialog`, which is a sign-in prompt the user asks for, not an ad.
- `DismissibleUpsell` had no other caller, so the component and its spec are deleted. Its
  `DismissIcon` glyph moved into `WarningRow`, its only other consumer.
- `upsell.taskList` (and the now empty `upsell` object) is removed from all 18 `cloud.json` files.

Kept on purpose: the `dismissUpsell` / `getDismissedUpsells` messages and the `dismissedUpsells`
global state, because the too-many-tools warning (#649) stores its dismissal there. A stored
`taskList2` id is harmless; nothing reads it any more. The `UPSELL_DISMISSED` / `UPSELL_CLICKED`
telemetry enum members in `packages/types` are now unused but left alone (shared types package,
knip does not flag them).

## Tests

- `ChatView.spec.tsx`: the "DismissibleUpsell Display Tests" block became "Welcome Screen Content
  Tests". The new test renders a signed-out user with 7 tasks, also sends an empty
  `dismissedUpsells` list, and asserts the `cloud:upsell.taskList` text is absent. Checked against
  `main` in a throwaway worktree: it fails there (the banner renders) and passes on the branch.
  The RooTips / active-task / editor-tab tests stay, without the upsell assertions.
- Dropped the `DismissibleUpsell`, `useCloudUpsell` and `CloudUpsellDialog` mocks from the ChatView
  specs; `TaskHeader.spec.tsx` now asserts the absence of the `longRunningTask` text directly.
- `tsc --noEmit` (webview-ui), eslint and prettier on the changed files, `find-missing-translations`
  pass; `pnpm knip` reports only two untracked local `zoo-port` skill scripts, unrelated.
