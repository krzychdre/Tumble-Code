# Show the error of a failed "Clear Index Data"

Branch: `fix/index-cleared-error-shown` (rebased onto origin/main eaeb9676a, after the S5 CodeIndexPopover split).

## Defect

The codebase index popover (`webview-ui/src/components/code-index/CodeIndexPopover.tsx`) offers
"Clear Index Data" when the index is Indexed or in Error. The confirm button posts `clearIndexData`.
The host handler (`src/core/webview/messageHandlers/codeIndex.ts`, `clearIndexData`, lines 343-370
on 639e47a29) answers with `{ type: "indexCleared", values: { success, error? } }` in three places:

- line 350: no workspace manager (`embeddings:orchestrator.indexingRequiresWorkspace`);
- line 359: success;
- line 363: `manager.clearIndexData()` threw. One real way: the index is in Error because
  initialization failed, `assertInitialized()` (`src/services/code-index/manager.ts:158`) throws
  "CodeIndexManager not initialized. Call initialize() first.".

## Root cause evidence

`grep -rn indexCleared webview-ui/src` on 639e47a29 finds nothing outside the i18n files: no
component, hook or reducer subscribes to the message, so the error is dropped and the user sees
no reaction. The S7 plan (`ai_plans/2026-09-28_s7-split-extension-message-types.md`, table of
unhandled names) lists the same finding. The new spec
`CodeIndexPopover.index-cleared.spec.tsx` fails on main for all three cases because the error
text never appears.

## Fix

- New hook `webview-ui/src/components/code-index/useIndexClearedError.ts`: subscribes to
  `indexCleared` with `useExtensionMessage`, keeps the last error, drops it on success.
  Success needs no other UI: the orchestrator already sets the state to Standby with
  "Index data cleared successfully.", which reaches the popover through `indexingStatusUpdate`.
- `CodeIndexActions` (the section that owns the clear button since the S5 split, #571) calls the
  hook and renders the error below the buttons with the same markup as the save error
  (`text-sm text-vscode-errorForeground`); the confirm action dismisses an old error before
  posting a new request. No prop changes on the popover.

## Other unhandled host messages from the S7 table

- `theme` (host to view): sent by `ClineProvider` on a colour theme change and by
  `webviewDidLaunch`. Its only consumer, the `theme` state in `ExtensionStateContext` fed by
  `textMateToHljs`, was removed in e012971b5 (#354, "code highlighting uses shiki with the body
  class instead"). Leftover: both sends, the configuration listener and `src/integrations/theme`
  (getTheme plus eight default theme JSON files, read from disk on every webview launch) are
  removed.
- `authenticatedUser` (host to view): sent after sign-out with `userInfo: undefined`, right after
  `postStateToWebview()`, whose state already carries `cloudUserInfo`. No consumer in webview-ui
  or the CLI. Leftover: the send is removed.
- `draggedImages` (view to host): posted by `ChatTextArea` after an image drop. No host handler
  (the router drops it), and the images were already added to the local selection one line
  above. Leftover: the post is removed.
- `insertTextIntoTextarea` (host to view): handled by `ChatTextArea`, nothing sends it. This is a
  receiver without a sender, not a sender; left in place (a spec pins it) and reported.

The dead type names are removed from `packages/types` together with the sends.

## Tests

- `CodeIndexPopover.index-cleared.spec.tsx`: failed error shown, success removes it, a new
  confirm removes it.
