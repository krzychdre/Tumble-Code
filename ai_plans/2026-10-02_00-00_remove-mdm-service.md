# Remove MdmService (managed-device cloud-login policy)

Status: done (branch `chore/remove-mdm-service`), owner decision B10 of
`ai_plans/2026-10-01_simplification-round-2.md`.

## Touched files

- Deleted: `src/services/mdm/MdmService.ts`, `src/services/mdm/__tests__/MdmService.spec.ts`,
  `.changeset/d4-mdm-redirect-helper.md` (unreleased changeset describing the helper that is now gone)
- Extension: `src/extension.ts`, `src/activate/registerCommands.ts`, `src/core/webview/ClineProvider.ts`,
  `src/core/webview/WebviewStatePusher.ts`, `src/core/webview/ProviderStateBuilder.ts`,
  `src/core/webview/messageHandlers/settings.ts`, `src/extension/cloudStartup.ts`
- Cloud package: `packages/cloud/src/CloudService.ts` (two wrappers only MDM called)
- Types: `packages/types/src/vscode-extension-host/settings.ts`, `packages/types/src/vscode-extension-host/state.ts`
- Webview: `webview-ui/src/App.tsx`, `webview-ui/src/context/ExtensionStateContext.tsx`
- i18n: `src/i18n/locales/*/common.json` (the `mdm` block, 18 locales)
- Docs: `docs/02-extension-host.md`
- Specs: `ClineProvider.spec.ts`, `webviewMessageHandler.routing.spec.ts` (+ snapshot),
  `ClineProvider.stateBuilder.spec.ts` snapshot, `extension.spec.ts`, `cloudStartup.spec.ts`,
  `packages/cloud/src/__tests__/CloudService.test.ts`, `packages/types/src/__tests__/vscode-extension-host-message-types.spec.ts`

## Problem

`MdmService` (inherited from Roo Code) read an enterprise policy file (`/etc/roo-code/mdm.json`,
`/Library/Application Support/RooCode/mdm.json`, `%ProgramData%\RooCode\mdm.json`, or `mdm.dev.json` when the Clerk
URL is not the production one). With `requireCloudAuth: true` it redirected every state push to the account tab
(`WebviewStatePusher.postMdmRedirectToWebview`, called at the end of all four push variants) and the webview refused
to leave the cloud tab (`App.tsx` `switchTab`, `mdmCompliant === false`), showing a warning through the
`showMdmAuthRequiredNotification` message. The fork has no managed-device deployment; the owner decided to remove it.

## Fix

Removed the service, its activation (awaited `MdmService.createInstance` in `activate`), the optional constructor
argument of `ClineProvider`, `checkMdmCompliance`, the `shouldRedirectToCloudAuth` host callback and the redirect
helper with its four call sites, the `getMdmCompliance` builder source and the `mdmCompliant` state field, the
webview tab lock, the handler and message type.

Things that only served MDM and went with it:

- `isCloudStartPending()` in `src/extension/cloudStartup.ts` (and the `timedOut` flag it read): its only caller held
  the MDM redirect back while the cloud started. `waitForCloudStart()` (used by `handleUri`) is unchanged.
- `CloudService.hasOrIsAcquiringActiveSession()` and `CloudService.getStoredOrganizationId()`: thin wrappers whose
  only caller was `MdmService.isCompliant()`. The auth-service methods behind them stay (used inside the package).
- Stray copies of the `manual_url_*` strings inside `mdm.errors` in 15 locales: the code reads them from
  `common:errors.*`, where every locale has them.

Message protocol changes (removals only, nobody sends or reads them any more):

- WebviewMessage type `showMdmAuthRequiredNotification` (only `App.tsx` sent it).
- ExtensionState field `mdmCompliant` (only `App.tsx` read it; `undefined` for every user without a policy file).

The state-push family in `WebviewStatePusher` keeps its order, payloads and sequence-number logic byte for byte: the
diff only removes the `await this.postMdmRedirectToWebview()` lines, the helper and the host callback.

## Tests

- Deleted with the code: `MdmService.spec.ts`, the `postMdmRedirectToWebview` block in `ClineProvider.spec.ts`, the
  routing case and snapshot for `showMdmAuthRequiredNotification` (routed type count 139 to 138), the three
  `"mdmCompliant": undefined` lines in the state-builder snapshot, the two `getStoredOrganizationId` wrapper tests.
- `cloudStartup.spec.ts` now observes the start through `waitForCloudStart()` instead of the removed flag
  (including the timeout release at 5 s and not before).
- Runs: src specs above + `activate/__tests__` + `ClineProvider.taskHistory` (436 passed), webview `App*.spec.tsx`
  (23), `CloudService.test.ts` (35), types message-type spec. `tsc --noEmit` in src, webview-ui, packages/types,
  packages/cloud clean; eslint clean; `pnpm knip` exit 0.

## Notes

- Users without a policy file see no change: the state field was `undefined` and the redirect never fired for them.
- A user who did have such a file can now use every tab without signing in.
