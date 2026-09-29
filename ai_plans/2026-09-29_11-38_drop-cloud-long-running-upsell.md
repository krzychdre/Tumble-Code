# Drop the "Continue from anywhere with Cloud" banner and false Cloud claims

**Status:** done (branch `fix/drop-cloud-upsell-banner`)
**Touched:**

- `webview-ui/src/components/chat/TaskHeader.tsx`
- `webview-ui/src/components/chat/__tests__/TaskHeader.spec.tsx`
- `webview-ui/src/components/cloud/CloudUpsellDialog.tsx`
- `webview-ui/src/components/cloud/__tests__/CloudUpsellDialog.spec.tsx`
- `webview-ui/src/components/cloud/__tests__/CloudView.spec.tsx`
- `webview-ui/src/i18n/locales/*/cloud.json` (18 locales)

## Symptom

Two minutes into any running task the task header showed a banner:

> This might take a while. Continue from anywhere with Cloud.

Clicking it opened the Cloud sign-in dialog. The banner is inherited from upstream Roo Code, whose
cloud could run tasks on hosted infrastructure. This fork's cloud cannot: the model always runs in
the local editor, and closing VS Code stops the task. The cloud only mirrors a running task over the
bridge so the owner can follow and control it from the web or a phone.

## What was happening

- `TaskHeader.tsx` started a 120 s timer whenever a task was open and its last relevant message was
  not `completion_result`, then rendered a `DismissibleUpsell` with `cloud:upsell.longRunningTask`.
  It did not check whether the user was signed in or whether a cloud was configured at all.
- While looking for siblings, two more strings turned out to be wrong for this fork:
  - `cloud:upsell.taskList` (home screen, signed-out users with 6+ tasks) promised "run autonomous
    Cloud agents", which do not exist here.
  - `cloud:cloudComingSoon` (Cloud sign-in dialog) said self-hosting the cloud backend is "coming
    soon", but self-hosting is the only way this fork's cloud runs.

## Fix

- Removed the timer, the banner, the `useCloudUpsell` hook call and the `CloudUpsellDialog` from
  `TaskHeader`, plus the `isTaskComplete` selector that only fed the banner.
- Removed `upsell.longRunningTask` and `cloudComingSoon` from all 18 locales, and the "coming soon"
  paragraph (with its `Clock` icon) from `CloudUpsellDialog`.
- Rewrote `upsell.taskList` in all locales without the autonomous-agents clause. The Hindi string
  still said "Roo" (रू) and now says Tumble like the others.

The `DismissibleUpsell` component and the `dismissUpsell` message stay: the home-screen `taskList2`
upsell still uses them. A user who had dismissed `longRunningTask` keeps that id in the stored
dismissed list; it is harmless and nothing reads it any more.

## Tests

- `TaskHeader.spec.tsx`: the 6-test "DismissibleUpsell behavior" block is replaced by one test that
  advances fake timers by 10 minutes on an unfinished task and asserts no upsell renders.
  `DismissibleUpsell` is mocked to render unconditionally, because the real one waits for the
  extension's dismissed list and would hide the banner even on the old code. Verified by swapping
  in the `origin/main` `TaskHeader.tsx`: the test fails there and passes on the branch.
- `CloudUpsellDialog.spec.tsx` / `CloudView.spec.tsx`: the "coming soon" assertion becomes an
  absence assertion.
- `tsc --noEmit` (webview-ui), eslint on the changed files, prettier, `find-missing-translations`,
  and `pnpm knip` all pass.
