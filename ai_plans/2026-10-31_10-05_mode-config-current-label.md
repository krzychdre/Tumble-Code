# "current" label in the bulk mode panel never showed

**Status:** done on `feat/mode-api-config-current-label` (stacked on `feat/mode-api-config-lock`)
**Related:** `ai_plans/2026-10-31_09-43_mode-api-config-lock.md`
**Touched:** `packages/types` (`global-settings.ts`, `settings-defaults.ts`, `vscode-extension-host/state.ts`),
`src/core/config/ProviderSettingsManager.ts`, `src/core/webview/ProviderStateBuilder.ts`, `ClineProvider.ts`,
`ClineProvider.stateBuilder.spec.ts` and its snapshot, the global key snapshot, `ApiConfigSelector.spec.tsx`

## Symptom

"Apply this configuration to other modes" should mark the modes already bound to the shown profile with "current"
(`ApiConfigSelector`, `modeApiConfigs?.[mode.slug] === value`). It never did.

## What was happening

- The mode bindings live in the profile store (`ProviderSettingsManager`, `modeApiConfigs` in the secret profiles
  data). `setModeConfig` and `setModeConfigs` write only there.
- `globalSettingsSchema` also declared a `modeApiConfigs` key. Nothing in the code base ever wrote it, so global
  state held only the default `{}`.
- `ProviderStateBuilder` listed that key as host-only and stripped it from the posted state, so the webview got
  `undefined`. Unstripping it would only have posted the empty dead copy.
- The panel came in with `eca81eb5e` (#69), which read `state.modeApiConfigs` without anything filling it, so the
  label never worked.

## Fix

- `ProviderSettingsManager.getModeConfigs()` returns the stored bindings.
- `ProviderStateBuilder` takes them through a new source `getModeApiConfigs()` and posts them as `modeApiConfigs`.
  An unreadable profile store is logged and posts `{}`, so the rest of the state still reaches the webview (same
  policy as an unavailable task history store).
- The dead global-state key is removed from `globalSettingsSchema` and `SETTINGS_DEFAULTS`; `ExtensionState`
  declares `modeApiConfigs` itself. `getState()` no longer carries a value that disagrees with the posted one (the
  "every key present in both views has the same value" characterization test caught exactly that disagreement).

## Tests

- `ClineProvider.stateBuilder.spec.ts`: the posted state carries a binding set in the profile store; an unreadable
  store posts `{}`. Snapshots replace the random default profile id with `<profile id>`.
- `ApiConfigSelector.spec.tsx`: "current" appears once, next to the only mode bound to the shown profile.
- Mutations (source returns `{}`, binding not posted, no catch, `getModeConfigs` returns `{}`, label always on) each
  turned a test red.

## Notes

- Settings exports contain only stored global-state keys (`ContextProxy.export` over `getValues`), and the removed
  key was never stored, so exports made by older versions do not carry it.
- Every full state push now reads the profile store once (one secret read and parse).
