# S5 (ChatTextArea part): split the composer into useMentionMenu, useHighlightLayer, ComposerToolbar

Roadmap item S5 (`ai_plans/2026-09-27_simplification-roadmap.md`, section 5, Priority 4): "`ChatTextArea`
(1,331): `useMentionMenu`, `useHighlightLayer`, `ComposerToolbar`." `ModesView` and `CodeIndexPopover` (the
other half of S5) are NOT in this change. Base: origin/main @ dd74df35c, rebased onto 72cf78b22 (S6, S7).

Pure refactor: observable behavior must be identical. No assertion in any pre-existing spec changed.

## 1. Responsibility map of ChatTextArea.tsx (1,332 lines at dd74df35c)

| Responsibility                                                                                                                                                                                                                                                                                                                                                               | Lines (approx)                                                                  | Disposition                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| Props, P1 selectors (16 `useExtensionSelector` calls)                                                                                                                                                                                                                                                                                                                        | 37-104                                                                          | split between the component and the new units |
| Dead "close dropdown" effect (`showDropdown` is never set to true)                                                                                                                                                                                                                                                                                                           | 116, 125-135                                                                    | **removed** (unobservable, see 4)             |
| Host messages: `enhancedPrompt`, `insertTextIntoTextarea`                                                                                                                                                                                                                                                                                                                    | 137-192, 213-217                                                                | stays                                         |
| **Mention menu**: `commitSearchResults`/`fileSearchResults` messages, menu state (query, index, type, loading, request id, results, commits), `searchCommits` effect, `queryItems`, click-outside, `handleMentionSelect`, menu keys, backspace-over-mention, menu part of `handleInputChange` with the 200 ms search debounce, reset-type effect, blur rule, mouse-down flag | 115-119, 193-210, 221-230, 242-251, 282-487, 516-558, 588-663, 665-672, 752-754 | **extracted** to `hooks/useMentionMenu.ts`    |
| Prompt history (already a hook)                                                                                                                                                                                                                                                                                                                                              | 233-240                                                                         | stays                                         |
| Enhance prompt, `hasInputContent`, `allModes`                                                                                                                                                                                                                                                                                                                                | 253-269                                                                         | stays                                         |
| Intended-cursor layout effect, cursor tracking, paste, drop, drag-over styling                                                                                                                                                                                                                                                                                               | 581-586, 674-750, 801-919, 949-975                                              | stays                                         |
| **Highlight layer**: `updateHighlights` (escape, mention marks, known-command marks, scroll sync) and its layout effect                                                                                                                                                                                                                                                      | 756-799                                                                         | **extracted** to `hooks/useHighlightLayer.ts` |
| **Action buttons** (images, enhance or cancel, queue, send or stop) and `sendKeyCombination`                                                                                                                                                                                                                                                                                 | 271-280, 1119-1259                                                              | **extracted** to `ComposerActionButtons.tsx`  |
| **Selector row** (ModeSelector, ApiConfigSelector, AutoApproveDropdown, IndexingStatusBadge, CloudAccountSwitcher) with `currentConfigId`/`displayName`, `handleModeChange`, `handleApiConfigChange`, `handleToggleLockApiConfig`                                                                                                                                            | 106-113, 923-940, 1292-1328                                                     | **extracted** to `ComposerToolbar.tsx`        |

The roadmap names three units; the button column became a fourth (`ComposerActionButtons`) because it is the
largest single JSX block (140 lines) and has nothing in common with the selector row except that both are
"toolbars". Putting both in `ComposerToolbar` would have given one component with two unrelated layouts.

## 2. Seams

### 2.1 `useMentionMenu(options)` (`webview-ui/src/components/chat/hooks/useMentionMenu.ts`)

Inputs: `textAreaRef`, `inputValue`, `setInputValue`, `setMode`, the composer cursor (`cursorPosition`,
`setCursorPosition`, `setIntendedCursorPosition`), `allModes`, `commands`. The cursor stays in
ChatTextArea because paste, drop and the intended-cursor layout effect share it.

Selects its own slices: `filePaths`, `openedTabs` (only the menu uses them).

Returns: `showContextMenu`, `contextMenuContainerRef`, `menuProps` (spread onto `ContextMenu`; the same 12
props as before), `handleMenuKeyDown(event) => boolean` (true when the menu consumed the key, the caller
returns), `handleMentionBackspace(event)`, `updateMenuForInput(value, cursor)`, `handleMenuBlur()`,
`closeMenu()` (the paste handler's URL branch).

`handleKeyDown` in ChatTextArea keeps the original order: menu keys, then history navigation, then
Enter, then Backspace (the menu's backspace logic, still gated on `!isComposing` by the caller).

The single `onExtensionMessage` subscription for four message types became two subscriptions with
disjoint types (`enhancedPrompt`/`insertTextIntoTextarea` in the component, `commitSearchResults`/
`fileSearchResults` in the hook). The bus delivers each message only to subscribers of its type, so no
message reaches a different handler than before. The component's subscription no longer re-subscribes
when `searchRequestId` changes (the hook's does), which is unobservable.

### 2.2 `useHighlightLayer(textAreaRef, inputValue, commands)` (`hooks/useHighlightLayer.ts`)

Returns `{ highlightLayerRef, updateHighlights }`; the text transformation moved verbatim into a private
`highlightComposerText(text, commands)`. The hook is called right after the intended-cursor layout effect,
so the two layout effects run in the same order as before.

### 2.3 `ComposerToolbar` (`ComposerToolbar.tsx`)

Props: `mode`, `setMode`, `modeShortcutText`, `selectApiConfigDisabled`, `isEditMode`. It selects its own
nine slices (`currentApiConfigName`, `listApiConfigMeta`, `customModes`, `customModePrompts`,
`pinnedApiConfigs`, `togglePinnedApiConfig`, `cloudUserInfo`, `lockApiConfigAcrossModes`,
`modeApiConfigs`) and computes `availableModes` from `getAllModes(customModes)`.

### 2.4 `ComposerActionButtons` (`ComposerActionButtons.tsx`)

Stateless: takes the flags (`isEditMode`, `isStreaming`, `hasInputContent`, `shouldDisableImages`,
`isEnhancingPrompt`, `enterBehavior`) and the callbacks. The tooltip content and the aria-label of the
send button were the same nested ternary written twice; they now share one `sendLabel` constant.

## 3. P1 selector subscriptions (kept narrow)

P1 (`ai_plans/2026-09-28_p1-extension-state-selector.md`) moved ChatTextArea to 16 narrow
`useExtensionSelector` calls. None regresses to `useExtensionState()`; they are only redistributed:

| Unit              | Slices                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatTextArea`    | `customModes`, `cwd`, `taskHistory`, `clineMessages`, `commands`, `enterBehavior` (6, down from 16)                                                                                         |
| `useMentionMenu`  | `filePaths`, `openedTabs`                                                                                                                                                                   |
| `ComposerToolbar` | `currentApiConfigName`, `listApiConfigMeta`, `customModes`, `customModePrompts`, `pinnedApiConfigs`, `togglePinnedApiConfig`, `cloudUserInfo`, `lockApiConfigAcrossModes`, `modeApiConfigs` |

Side effect (performance only): a change to an API-config or cloud slice now re-renders only
`ComposerToolbar`, not the whole composer. `ChatTextArea` still selects `clineMessages` for the prompt
history, so it still re-renders on streamed tokens; the React Compiler memoizes the `<ComposerToolbar>` and
`<ComposerActionButtons>` elements, so those subtrees skip those renders when their props are unchanged.

The spec-mock pattern from P1 still works unchanged: specs call `vi.mock("@src/context/ExtensionStateContext")`
and give `useExtensionSelector` a `mockImplementation((selector) => selector(state))`. That automock is
module-wide, so the selectors now living in the hook and the toolbar read the same fake state. None of the
54 pre-existing ChatTextArea tests needed a change.

## 4. Deliberate non-moves and removals

- Removed: `showDropdown` state and its document `mousedown` listener. `setShowDropdown(true)` is never
  called anywhere, so the listener only ever called `setShowDropdown(false)` guarded by `if (showDropdown)`,
  a no-op. No behavior depends on it.
- Kept as is: `textAreaBaseHeight` (written, only read by its own setter guard) and the never-reset
  `isMouseDownOnMenu` flag (after the first mousedown on the menu, blur never closes the menu again). Both
  look odd but are behavior; fixing them is not part of a refactor. The second one is pinned by a test.
- Paste and drop handling stay in ChatTextArea (not named by the roadmap; they share the cursor).

## 5. Tests

Commit 1 (characterization, passes on main before the move):

- `__tests__/ChatTextArea.mentionMenu.spec.tsx` (32 tests). `ContextMenu` is replaced by a probe that records
  its props, so the tests pin the contract between the composer and the menu: opening on "@" and "/",
  `queryItems` from tabs and files, 200 ms search debounce with unescaped query, stale request ids ignored,
  commit search and results, arrow keys with wrap and header skipping, Enter and Tab selection, Escape out
  of a submenu, every selection kind, outside mousedown and blur closing, backspace over a mention,
  `insertTextIntoTextarea`; highlight layer HTML (marks, escaping, trailing newline, known commands only),
  re-highlight on command list change, scroll sync.
- `__tests__/ChatTextArea.toolbar.spec.tsx` (16 tests). Probes for the five selector-row children pin the
  props and callbacks; the action buttons are tested through the DOM (images, enhance, cancel and Escape in
  edit mode, queue, stop, send, placeholder hint).

Commit 2 (the move): all four ChatTextArea spec files pass unchanged (54 pre-existing + 48 new = 102), plus
the ChatView, ChatRow image and ExtensionStateContext specs (19 files, 232 tests).

## 6. Measurements

| File                              | Before | After |
| --------------------------------- | ------ | ----- |
| `chat/ChatTextArea.tsx`           | 1,332  | 704   |
| `chat/hooks/useMentionMenu.ts`    | -      | 489   |
| `chat/hooks/useHighlightLayer.ts` | -      | 63    |
| `chat/ComposerToolbar.tsx`        | -      | 117   |
| `chat/ComposerActionButtons.tsx`  | -      | 187   |

React Compiler bailouts (`node ../scripts/check-react-compiler-bailouts.mjs` from `webview-ui`): 8 before,
8 after (same baseline; ChatTextArea and all four new units compile).
