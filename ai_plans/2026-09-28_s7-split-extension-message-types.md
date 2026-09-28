# S7: split ExtensionMessage and WebviewMessage by domain

Roadmap item (ai_plans/2026-09-27_simplification-roadmap.md, section 5):
`packages/types/src/vscode-extension-host.ts` (1,041 lines): split `ExtensionMessage` and
`WebviewMessage` by domain, mirroring `messageHandlers/`; remove the message names nothing handles.

Refactor plus dead-name removal, no behavior change. Base: main @ 02a873ef7, rebased onto ec2c3a7d6.
Branch `refactor/s7-split-extension-message-types`.

## 1. Starting point

- An earlier attempt (`refactor/pkg-11-extension-message-domains`, worktree `/tmp/roo-wt-pkg11-msg`)
  already landed as PKG-11 (#437): it grouped the type names into ten domain unions inside the one
  file (`ExtensionTaskMessageType`, `WebviewUiMessageType`, ...) and added
  `vscode-extension-host-message-types.spec.ts`, which pins both name sets (75 and 153 names on
  main before S7). Nothing else from that branch was left to port.
- Those ten groups did not match the host's handler modules: `WebviewUiMessageType` alone mixed names
  handled by `settings.ts`, `filesAndCheckpoints.ts`, `enhanceAndSearch.ts` and `debug.ts`. No code
  outside the types package used any of the twenty group unions.

## 2. Method for "nothing sends or handles it"

For every name, in its direction:

- Host handlers of `WebviewMessage`: the keys of the 16 maps in `src/core/webview/messageHandlers/`
  (138 names, the same count the registry spec pins) plus the `switch` in
  `src/core/webview/PlanReviewPanel.ts` (4 names). `webviewMessageHandler` drops any other type.
- Senders of `WebviewMessage`: every quoted literal in `webview-ui/src`, `apps/cli/src`, `src` and
  `packages`, excluding the types file itself, specs, snapshots and i18n.
- Senders of `ExtensionMessage`: quoted literals in `src` and `packages` (`postMessageToWebview`,
  `panel.webview.postMessage`), handlers: literals in `webview-ui/src` and `apps/cli/src`
  (`onExtensionMessage`, `useExtensionMessage`, `message.type ===`, reducer `case`).
- Every grep hit was read to tell a send from a handler (a name used in both directions shows up in
  both trees).
- Final proof: after removing the names, `tsc --noEmit` passes in `packages/types`, `src`,
  `webview-ui`, `apps/cli`, `packages/cloud`, `packages/core` and `packages/vscode-shim`, all of which
  include their specs, so no typed code, test included, names a removed type in the removed direction.

## 3. Removed names (19 union entries, 4 names gone entirely)

ExtensionMessage (host to view), 9:

| Name                          | Evidence                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `branchWorktreeIncludeResult` | no literal anywhere outside the types file                                                                     |
| `codebaseIndexConfig`         | only as a global-state key (`getGlobalState("codebaseIndexConfig")`), never as a message type                  |
| `setHistoryPreviewCollapsed`  | no literal anywhere outside the types file                                                                     |
| `vsCodeLmApiAvailable`        | no literal anywhere outside the types file                                                                     |
| `autoApprovalEnabled`         | only sent view to host (`AutoApproveDropdown.tsx`, `AutoApproveSettings.tsx`, `ExtensionStateContext.tsx:276`) |
| `deleteCustomMode`            | only sent view to host (`ModesView.tsx:624`, `:1252`)                                                          |
| `toggleApiConfigPin`          | only sent view to host (`ApiConfigSelector.tsx:192`)                                                           |
| `updateCustomMode`            | only sent view to host (`ModesView.tsx:140`)                                                                   |
| `updatePrompt`                | only sent view to host (`ModesView.tsx:132`, `:341`)                                                           |

WebviewMessage (view to host), 10. All are host replies that were also listed as requests; no view
or CLI code posts them and no host module handles them. They stay in `ExtensionMessage`, where they
are sent and handled:

`checkRulesDirectoryResult`, `enhancedPrompt`, `exportModeResult`, `importModeResult`,
`indexCleared`, `indexingStatusUpdate`, `marketplaceInstallResult`, `shareTaskSuccess`,
`systemPrompt`, `vsCodeSetting`.

`webviewMessageHandler.routing.spec.ts` still posts `enhancedPrompt` as its sample of an unhandled
type (its `ROUTES` table is typed `string`), which remains a valid runtime check.

## 4. Findings kept, not deleted (only one side exists)

| Direction                 | Name                           | Side that exists                                                                          | Missing side                                                                                                            |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| view to host              | `draggedImages`                | sent by `webview-ui/src/components/chat/ChatTextArea.tsx:900` after a drop                | no handler; the router drops it. The dropped images are already added locally, so the post looks like a leftover.       |
| host to view              | `authenticatedUser`            | sent by `src/core/webview/messageHandlers/cloudAuth.ts:87` on sign-out                    | no handler in webview-ui or the CLI.                                                                                    |
| host to view              | `indexCleared`                 | sent by `src/core/webview/messageHandlers/codeIndex.ts:350`, `:359`, `:363`               | no handler, so the error of a failed clear (for example "no workspace open") never reaches the UI.                      |
| host to view              | `theme`                        | sent by `src/core/webview/ClineProvider.ts:951` and `messageHandlers/taskLifecycle.ts:29` | no handler in webview-ui or the CLI (only `extensionBus.spec.ts` uses it as a sample name).                             |
| host to view              | `insertTextIntoTextarea`       | handled by `webview-ui/src/components/chat/ChatTextArea.tsx:163`                          | nothing sends it.                                                                                                       |
| field of ExtensionMessage | `branch`, `hasWorktreeInclude` | declared, comment pointed at `branchWorktreeIncludeResult`                                | nothing sets or reads them now; kept because this item removes names, not fields (the surface spec pins the field set). |

Each is a small follow-up of its own (delete the dead send, or wire the handler if the behavior is
wanted); none was changed here.

## 5. Layout after the split

```
packages/types/src/vscode-extension-host.ts          assembly point (458 lines)
packages/types/src/vscode-extension-host/
  taskLifecycle.ts  messageEdits.ts  settings.ts  debug.ts  codeIndex.ts  customModes.ts
  worktrees.ts  commandsAndSkills.ts  cloudAuth.ts  enhanceAndSearch.ts  providerProfiles.ts
  marketplace.ts  mcp.ts  promptsAndModes.ts  filesAndCheckpoints.ts  subagents.ts  planReview.ts
  state.ts          ExtensionState
  chat-rows.ts      ClineSayTool, ClineAskUseMcpServer, ClineApiReqInfo, ClineApiReqCancelReason
  legacy-groups.ts  the ten pre-S7 group unions per side, @deprecated Extract aliases
```

- One file per module of `src/core/webview/messageHandlers/` (same file names) plus `planReview`
  (handled by `PlanReviewPanel`). Each holds `<Domain>WebviewMessageType` (exactly the keys that
  module handles; `filesAndCheckpoints` also lists the unhandled `draggedImages`),
  `<Domain>ExtensionMessageType` (host messages of that domain; `debug` has none) and the domain's
  payload types (checkpoint schemas, indexing status, marketplace install schema, Codex rate limit
  messages, `CliModeProviderSettings`, `Command`, `AudioType`, ...).
- `vscode-extension-host.ts` defines `ExtensionMessageTypesByDomain` and
  `WebviewMessageTypesByDomain` (domain key to union), `ExtensionMessageType` and
  `WebviewMessageType` as their value unions, the `ExtensionMessage` and `WebviewMessage`
  interfaces (fields unchanged) and `WebViewMessagePayload`, and re-exports every domain file.
- The interfaces keep one flat optional field bag. Splitting the fields into per-domain interfaces
  would only regroup the same optional bag; the step that buys type safety is a per-type
  discriminated union (noted in `messageHandlers/types.ts`), left for later.
- The deprecated group aliases keep the public surface identical (nothing in the repo imports them);
  they can go once no outside consumer of `@roo-code/types` needs them.

Host side, enforcing the mirror: `messageHandlers/types.ts` adds `HandlerDomain` and
`DomainHandlerMap<D>`; each module is typed `DomainHandlerMap<"<module>">`, and
`messageHandlerGroups` is typed `{ [D in HandlerDomain]: DomainHandlerMap<D> }`. A handler registered
in the wrong module is an excess-property error, and a domain that exists on only one side is a
missing-property error (both checked with a throwaway file: TS2353 and TS2741).

## 6. Commits and tests

1. `test(types): pin the public surface ...`: `vscode-extension-host-surface.spec.ts` imports every
   type the module exported through the package entry, pins the field sets of both interfaces and
   parses with the three zod schemas. Passes on main.
2. `refactor(types): drop the 19 channel message names ...`: removal plus the updated name sets in
   `vscode-extension-host-message-types.spec.ts` (66 and 143 names).
3. `refactor(types): split the channel message types ...`: the move, the typed handler modules, and
   the message-types spec checking the partition with one `Overlaps<M>` helper (plus "no empty
   domain" and "the deprecated groups still partition both sets") instead of 81 pairwise assertions. The
   surface spec passes unchanged.
4. Plan doc, changeset, the stale field comment.

Gates: types specs 2 files / 9 tests; `registry.spec.ts` + `webviewMessageHandler.routing.spec.ts`
153 tests; `tsc --noEmit` clean in types, src, webview-ui, apps/cli, cloud, core, vscode-shim;
eslint on touched files; `pnpm knip` exit 0.
