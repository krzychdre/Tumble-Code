# Feat: assign current API config profile to many modes at once - Implementation Plan

**Date:** 2026-06-01
**Author:** Claude (with user collaboration)
**Status:** Implemented on branch (not committed, no PR)
**Branch:** `feat/assign-api-config-to-modes`

## 1. Objective

Let a user fast-assign the **currently-active API configuration profile** to all
(or a chosen subset of) modes in one action, from the chat "model combo"
([ApiConfigSelector.tsx](../webview-ui/src/components/chat/ApiConfigSelector.tsx)).

Motivation (user): people running **local inference engines** can only realistically
serve one model at a time; switching the loaded model is slow. Per-mode profiles force
them to re-pick the config every time they change mode. They want one click to make
every mode use the same profile.

## 2. Key domain fact (why this is profile-level, not model-id-level)

A mode is not bound to a bare model id. It is bound to a whole **API configuration
profile** via `modeApiConfigs: Record<modeSlug, configId>`
([ProviderSettingsManager.ts:476](../src/core/config/ProviderSettingsManager.ts#L476)
`setModeConfig`). On `handleModeSwitch`, the mode's saved profile is activated
(unless `lockApiConfigAcrossModes` is on). A profile carries provider + model + keys,
so "use the same model for all modes" == "assign this profile to all modes".

Confirmed with user: **assign the current profile** to each selected mode (not rewrite
a model-id field inside each mode's existing profile).

## 3. UX (confirmed with user)

In the `ApiConfigSelector` popover, add a bottom-bar action ("checklist" icon) that
swaps the popover body to a **mode checklist**:

- Lists all modes (`getAllModes(customModes)`), **all checked by default**.
- A mode already mapped to the current profile shows an indicator.
- "Select all / none" toggle for convenience.
- **Apply** button posts the assignment for the checked modes, then closes.
- **Confirmation gate**: when the number of selected modes is large
  (`LARGE_MODE_ASSIGN_THRESHOLD = 10`), Apply first shows an inline confirm step
  ("Assign the profile to N modes?") before committing.

This single UI satisfies both "all modes" (default state) and "most/specific modes"
(uncheck a few).

## 4. Data flow

1. `ApiConfigSelector` posts `{ type: "assignCurrentApiConfigToModes", values: { configId, modeSlugs } }`.
   `configId` is the selector's `value` (the active profile id).
2. `webviewMessageHandler` case → `provider.providerSettingsManager.setModeConfigs(modeSlugs, configId)` → `provider.postStateToWebview()`.
3. `setModeConfigs` writes `modeApiConfigs[slug] = configId` for every slug under a
   **single lock/store** (bulk; not N round-trips).
4. Refreshed state re-renders the checklist indicators (`modeApiConfigs` is already in
   webview state).

No activation side effects: the active mode already uses the active profile; this only
persists which profile each _other_ mode will load when next switched to.

## 5. File Changes

| Action | File Path                                                                      | Brief Purpose                                                       |
| ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| MOD    | `src/core/config/ProviderSettingsManager.ts`                                   | New bulk `setModeConfigs(modes, configId)` (single lock)            |
| MOD    | `src/core/config/__tests__/ProviderSettingsManager.spec.ts`                    | Unit tests for `setModeConfigs`                                     |
| MOD    | `packages/types/src/vscode-extension-host.ts`                                  | Add `"assignCurrentApiConfigToModes"` message type                  |
| MOD    | `src/core/webview/webviewMessageHandler.ts`                                    | Handle the new message → bulk assign + post state                   |
| NEW    | `src/core/webview/__tests__/webviewMessageHandler.assignConfigToModes.spec.ts` | Handler test                                                        |
| MOD    | `webview-ui/src/components/chat/ApiConfigSelector.tsx`                         | Mode checklist panel + confirm gate + post message                  |
| MOD    | `webview-ui/src/components/chat/ChatTextArea.tsx`                              | Pass `availableModes` + `modeApiConfigs` props                      |
| MOD    | `webview-ui/src/components/chat/__tests__/ApiConfigSelector.spec.tsx`          | Component tests (checklist, default-all, apply posts, confirm gate) |
| MOD    | `webview-ui/src/i18n/locales/*/chat.json`                                      | New UI strings (all locales)                                        |

## 6. TDD order

1. **Backend unit** — `setModeConfigs` (write test, watch fail, implement).
2. **Backend handler** — `assignCurrentApiConfigToModes` case.
3. **Webview component** — checklist renders all-checked, Apply posts correct message,
   large-count shows confirm before posting.

## 7. Verification Standards

- [x] `setModeConfigs` persists all slugs in one store; preserves unrelated modes.
      (4 tests, ProviderSettingsManager suite 46/46.)
- [x] Handler calls `setModeConfigs` with payload slugs+configId and posts state;
      no-ops on empty slugs or missing configId. (3 tests.)
- [x] Component: opening checklist shows all modes checked; Apply (small N) posts
      `assignCurrentApiConfigToModes` with the checked slugs + current configId; Apply
      (N ≥ threshold) requires a confirm click first. (ApiConfigSelector 26/26.)
- [x] `tsc --noEmit` clean for `src`, `packages/types`, `webview-ui`.
- [x] Existing ApiConfigSelector / ProviderSettingsManager / ChatTextArea-lock suites
      still green; `find-missing-translations` reports no missing keys (all 18 locales).
