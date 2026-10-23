# R4 D4: small webview items (mention menu, scroll lifecycle, ChatView, SettingsView, ApiOptions)

**Status:** done

**Related plans:** [maintenance audit round 4](2026-10-23_17-20_maintenance-audit-round-4.md), item D4 (webview
bullets; the `apps/cli/src/ui/App.tsx` bullet belongs to the CLI lane).

## Touched files

- `webview-ui/src/components/chat/hooks/useMentionMenu.ts`, `webview-ui/src/components/chat/ContextMenu.tsx`,
  `webview-ui/src/utils/context-mentions.ts`, `webview-ui/src/components/chat/__tests__/ChatTextArea.mentionMenu.spec.tsx`
- `webview-ui/src/hooks/useScrollLifecycle.ts`
- `webview-ui/src/components/chat/ChatView.tsx`
- `webview-ui/src/components/settings/SettingsView.tsx`
- `webview-ui/src/components/settings/ApiOptions.tsx`, `webview-ui/src/components/settings/providers/OpenRouter.tsx`,
  `webview-ui/src/components/settings/providers/__tests__/OpenRouter.spec.tsx`

## Change

- **useMentionMenu:** the `insertValue` chain keeps only Problems and Terminal (the URL, File/Folder and Git branches
  equalled the default, the Command branch was unreachable). `getMenuOptions()` and `isSelectableOption` (now in
  `context-mentions.ts`, shared with `ContextMenu`) replace two copies each. `FIRST_COMMAND_INDEX` and
  `EMPTY_MENTION_DEFAULT_INDEX` name the magic indices; the latter is 3, which is the Folder row of the empty "@"
  menu (Problems, Terminal, URL, Folder, File, Git), so the specs now say "Folder row". `hideMenu` closes the menu
  and leaves the submenu in one step, replacing the effect that reset `selectedType` after every close.
- **useScrollLifecycle:** `handlePointerDown` calls `handlePointerEnd` for its two early exits; the effect that
  copied `scrollPhase` into `scrollPhaseRef` is gone (`transitionScrollPhase` writes both); `scrollPhase` is no
  longer returned (no caller read it).
- **ChatView:** `taskCosts` is looked up once for the task header; one `askButtonTooltip` helper builds both
  action-button tooltips; the unmount effect that cleared the ever-visible cache is gone (the cache lives in this
  component's state and goes with it). The task-switch and hidden-view clears stay, in their order after
  `markEverVisible`.
- **SettingsView:** `sections` is a module constant; `asSectionName` replaces the duplicated `targetSection`
  check; a new `targetSection` opens its tab during render (stored previous value) instead of in an effect; the
  `renderTab` alias is gone.
- **ApiOptions:** no `apiConfiguration?.` on the required prop. The OpenRouter provider-routing select moves from
  the generic Advanced settings into the hand-written OpenRouter form (shown below its model picker, hidden in the
  simplified welcome form as before).

## Tests

- `ChatTextArea.mentionMenu.spec.tsx`: new case "closing the menu leaves a submenu, so the next '@' starts at the
  top level". Mutation: `hideMenu` without `setSelectedType(null)` turned it red. Other mutations (default index
  4, first command index 0, section headers selectable, wrong problems mention) each turned existing cases red.
- `OpenRouter.spec.tsx` (new): the routing select lists the default and the model's providers and stores the
  choice; it is hidden in the simplified form and without providers; the providers query is enabled only when the
  model is one of several listed models. Mutations (no simplified check, `> 0` instead of `> 1`, no membership
  check, wrong settings key) each turned one case red.
- `SettingsView.spec.tsx` switches tabs through `targetSection`; dropping the tab switch turned 10 cases red.
- `src/components/settings`, `src/components/welcome`, ChatView, ChatTextArea, ContextMenu and `src/hooks` specs
  green; tsc, eslint and the React Compiler bailout check (6 known) pass. The two `set-state-in-effect` findings
  in `useMentionMenu.ts` and `SettingsView.tsx` are gone.
