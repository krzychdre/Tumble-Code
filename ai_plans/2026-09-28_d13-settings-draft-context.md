# D13: SettingsDraftContext, sections read the Save buffer with `useSetting(key)`

Roadmap item D13 (`ai_plans/2026-09-27_simplification-roadmap.md`, section 3): "Settings prop drilling:
`SettingsView` passes ~15 props plus `setCachedStateField` to each section. Fix: `SettingsDraftContext` with
`useSetting(key)` returning `[value, set]` over the same buffer (keeps the cachedState rule)." Effort M.
Base: origin/main @ 927a4248e.

Pure refactor: what the user sees and what Save posts must be identical.

## 1. Problem verified on main

`SettingsView.tsx` rendered 13 buffered sections with 98 props in total (AutoApprove 17, ContextManagement 22,
Terminal 12, Memory 10, Experimental 10, the rest 2 to 4 each). Every value came from the Save buffer
(`useCachedSettings`, the `cachedState` rule of `AGENTS.md`), every write went back through
`setCachedStateField` or a per-key wrapper arrow (`setCustomSupportPrompts`, `setTelemetrySetting`,
`setImageGenerationProvider`, ...). A few call sites applied a default on the way (`?? true`, `|| "en"`,
`?? 200`, `|| {}`), so the effective value of a setting was split between the view and the section.

## 2. Design

- **`settings/settingsDraftStore.ts`**: the buffer becomes a tiny external store (`subscribe`, `getState`,
  `isDirty`, `setField`, `setApiConfigurationField`, `setExperimentEnabled`, `setDirty`, `mergeFromState`,
  `resetToState`). The write rules are moved verbatim from `useCachedSettings` (schema `equals` for no-op
  writes, the provider-field "automatic first fill is not dirty" rule, merge keeps absent keys, reset clears
  the flag). Each write replaces the buffer object once and notifies once; unwritten keys keep their value
  identity, so `getState()[key]` is a valid `useSyncExternalStore` snapshot.
- **`useCachedSettings`** keeps its return shape for `SettingsView` (plus `store`) and reads the whole buffer
  and the dirty flag through `useSyncExternalStore`. Save, the discard dialog, profile switch
  (`mergeFromState`) and settings import work exactly as before because `SettingsView` code for them did not
  change.
- **`settings/SettingsDraftContext.tsx`**: `SettingsDraftProvider` (value = the store, identity never
  changes), `useSetting(key)` returning `[value, set]` typed by key (`CachedSettings[K]`, i.e. the
  `ExtensionState` type of that key), and `useSettingsDraft()` for the writes a single key does not cover
  (`setExperimentEnabled`, the dynamic key of `AutoApproveToggle`).
- Why an external store and not a context holding the buffer: a context value that changes on every edit
  re-renders every consumer on every edit. The per-key subscription keeps what the React Compiler gave the
  old props version in production (a section re-rendered only when one of its own props changed), so there
  is no render regression. Measured in `SettingsDraftContext.spec.tsx`: over 20 edits of an unrelated key a
  `useSetting("language")` control renders 1 time (mount only), a whole-buffer-context consumer 21 times.

Why not P1's `useExtensionSelector`: that store is the live extension state; the Settings view must read the
buffer, never the live state (the cachedState rule). The pattern (`useSyncExternalStore` over a stable store
handle in context) is the same.

## 3. Migration

All 13 buffered sections, mechanically: each prop `x` became `const [x, setX] = useSetting("x")`, each
`setCachedStateField("x", v)` became `setX(v)`. Defaults that `SettingsView` applied moved into the section
with the same operator (`?? true`, `?? "send"`, `?? "comfortable"`, `|| "en"`, `|| {}`, `?? undefined`,
`= 60000`, `profileThresholds = {}`).

| Section                   | Props before | Props after                            |
| ------------------------- | ------------ | -------------------------------------- |
| AutoApproveSettings       | 17           | 0                                      |
| CheckpointSettings        | 3            | 0                                      |
| MemorySettings            | 10           | 1 (`listApiConfigMeta`, not a setting) |
| WebToolsSettings          | 4            | 0                                      |
| NotificationSettings      | 3            | 0                                      |
| ContextManagementSettings | 22           | 1 (`listApiConfigMeta`)                |
| TerminalSettings          | 12           | 1 (`onTerminalProfilePickerOpened`)    |
| SubagentSettings          | 3            | 0                                      |
| PromptsSettings           | 4            | 0                                      |
| UISettings                | 4            | 0                                      |
| ExperimentalSettings      | 10           | 0 (two of them were unused)            |
| LanguageSettings          | 2            | 0                                      |
| About                     | 4            | 0                                      |
| **Total**                 | **98**       | **3** (95 removed)                     |

Two conditionals that only guarded optional setter props are gone because the setter now always exists:
`About` rendered the debug checkbox only `{setDebug && ...}` and `ExperimentalSettings` required three
image-generation setters; `SettingsView` always passed them, so the rendered output is unchanged.
`PromptsSettings` keeps its "buffer, then live state, then `true`" fallback for `includeTaskHistoryInEnhance`.
`settings/types.ts` (`SetCachedStateField`, `SetExperimentEnabled`) had no users left and is deleted.

Left as they are:

- **Providers tab** (`ApiConfigManager`, `ApiOptions`): they take `apiConfiguration`, `setApiConfigurationField`
  and the view's local `errorMessage` state; `ApiOptions` is also a large tree with its own specs and provider
  forms (S4 descriptors). Moving it is a separate item.
- **`TerminalSettings.onTerminalProfilePickerOpened`**: kept as a prop (it marks the form dirty without a
  value change); `SettingsView.save-defaults.spec.tsx` drives it through the section mock.
- Modes, MCP, Worktrees, Skills, Slash commands: not buffered sections (no props from the buffer).

## 4. Tests

- Commit 1 (characterization, passes on main): `SettingsView.draft-buffer.spec.tsx` renders the real
  `SettingsView` with every real section. For each of the 13 sections one user edit marks the form dirty and
  Save posts exactly the messages pinned in the snapshot (plus any immediate post the edit makes); the edit
  lives in the buffer, not the live state; discarding restores every edited field and clears the flag;
  cancelling keeps the edit; an edit survives a tab switch. 17 tests, unchanged by commit 2.
- `SettingsDraftContext.spec.tsx` (new): store semantics (the rules moved from `useCachedSettings`, which had
  no spec), `useSetting` value and setter, setter identity, error outside the provider, render measurement.
- Section specs (`About`, `AutoApproveSettings.immediate`, `ContextManagementSettings`, `MemorySettings`,
  `PromptsSettings.immediate`, `TerminalSettings.profile`, `UISettings`, the `button`/`checkbox`/`link`/
  `text-area` call-site specs) now render through `renderWithSettingsDraft` (`__tests__/settingsDraftTestUtils.tsx`)
  over a real buffer; assertions on `setCachedStateField(key, value)` became assertions on the buffer's
  `setField(key, value)`. One expectation changed because the buffer is now real: in
  `AutoApproveSettings.immediate`, adding "sudo" then removing entry 0 leaves `["sudo"]` (the old test's prop
  mock never updated the list, so it removed from the stale one-item list).
- All other `SettingsView.*.spec.tsx` pass unmodified.

React Compiler bailouts: 8 before, 8 after (`scripts/check-react-compiler-bailouts.mjs`).
