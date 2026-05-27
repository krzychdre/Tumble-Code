# Custom Sound Effects — investigation & implementation plan

**Date:** 2026-05-27
**Branch:** `feat/custom-sound-effects`
**Status:** Draft

## 1. Objective

Allow the user to upload a custom audio file (WAV / MP3 / OGG) for each of the three notification sounds (`celebration`, `progress_loop`, `notification`) on the **Notifications** settings page, with a per-slot "Reset to default" button. The custom file is copied into the extension's `globalStorage`, plays via the existing `use-sound` pipeline, and is rejected if its duration exceeds **10 seconds**.

## 2. Evidence (Current Behavior)

- Built-in audio files live in [webview-ui/audio/](webview-ui/audio/): `celebration.wav` (task completed), `progress_loop.wav` (api_req_failed, mistake_limit), `notification.wav` (interaction required). Mirrored at [src/webview-ui/audio/](src/webview-ui/audio/) for backend testing.
- Playback hook: [webview-ui/src/components/chat/ChatView.tsx:231-265](webview-ui/src/components/chat/ChatView.tsx#L231-L265) wires three `useSound(${audioBaseUri}/${name}.wav, ...)` calls, switched by `AudioType` in `playSound()`. `use-sound` internally re-creates the underlying `Howl` whenever `src` changes (see [webview-ui/node_modules/use-sound/dist/use-sound.cjs.development.js](webview-ui/node_modules/use-sound/dist/use-sound.cjs.development.js) — the effect depends on stringified `src`), so swapping the URL hot-swaps the audio.
- `audioBaseUri` is populated from `window.AUDIO_BASE_URI`, injected by [src/core/webview/ClineProvider.ts:1287](src/core/webview/ClineProvider.ts#L1287) (HMR) and [src/core/webview/ClineProvider.ts:1366](src/core/webview/ClineProvider.ts#L1366) (prod), produced by `webview.asWebviewUri(joinPath(extensionUri, "webview-ui/audio"))`.
- `AudioType` literal: [packages/types/src/vscode-extension-host.ts:401](packages/types/src/vscode-extension-host.ts#L401) — `"notification" | "celebration" | "progress_loop"`.
- Notification settings UI: [webview-ui/src/components/settings/NotificationSettings.tsx](webview-ui/src/components/settings/NotificationSettings.tsx). Hooked into [webview-ui/src/components/settings/SettingsView.tsx:819-826](webview-ui/src/components/settings/SettingsView.tsx#L819-L826) with `soundEnabled` / `soundVolume` props.
- Sound schema fields: [packages/types/src/global-settings.ts:160-161](packages/types/src/global-settings.ts#L160-L161) (`soundEnabled`, `soundVolume`).
- `ExtensionState` exposes those two via [packages/types/src/vscode-extension-host.ts:273-274](packages/types/src/vscode-extension-host.ts#L273-L274).
- Generic settings flow: webview posts `{ type: "updateSettings", updatedSettings }`, handler at [src/core/webview/webviewMessageHandler.ts:655-751](src/core/webview/webviewMessageHandler.ts#L655-L751) iterates keys and calls `contextProxy.setValue(...)`, then `postStateToWebview()`.
- Webview's `localResourceRoots` is set in [src/core/webview/ClineProvider.ts:872-882](src/core/webview/ClineProvider.ts#L872-L882) (extensionUri + workspace folders). Custom-sound globalStorage isn't reachable today — must be added.
- File picker precedent: [src/integrations/misc/process-images.ts:5-30](src/integrations/misc/process-images.ts#L5-L30) uses `vscode.window.showOpenDialog`; routed through `case "selectImages":` in [src/core/webview/webviewMessageHandler.ts:769-770](src/core/webview/webviewMessageHandler.ts#L769-L770).
- `globalStorageUri.fsPath` is already used in several places (e.g. [src/core/webview/ClineProvider.ts:1714](src/core/webview/ClineProvider.ts#L1714)); we'll add a new subdirectory `custom-sounds/`.

## 3. Target Behavior

| Scenario                                        | Result                                                                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sound disabled                                  | Nothing plays. Custom-file rows are hidden (mirrors existing "volume" gating).                                                                                                               |
| Sound enabled, no custom file set               | Built-in WAV plays (today's behaviour). Each row shows "Choose…" button.                                                                                                                     |
| User picks a `.wav` ≤ 10 s for "Task completed" | File is copied to `globalStorage/custom-sounds/celebration-<id>.<ext>`, old copy removed. New URL hot-swaps into `useSound`. Row shows filename + Reset.                                     |
| User picks a file > 10 s                        | Webview loads the URL, reads `audio.duration` via a hidden `<audio>`, posts `resetCustomSound`, shows toast. Setting is cleared, file deleted.                                               |
| Reset button                                    | Posts `resetCustomSound`, extension deletes the file, clears the setting, re-pushes state. Built-in WAV is used again.                                                                       |
| Settings export/import                          | The setting stores only the **basename** that lives under `custom-sounds/`. Importing on another machine without that file falls back to the built-in (URI lookup just returns `undefined`). |

Volume + enable/disable continue to apply to all sounds (built-in or custom).

## 4. Tech Strategy

- **Schema.** Three new optional keys on `globalSettingsSchema`: `customSoundCelebration`, `customSoundProgressLoop`, `customSoundNotification`. Each stores the **basename** (e.g. `celebration-9f3a.wav`) of the file inside `globalStorage/custom-sounds/`. Keeping it a basename — not a full path or URI — makes it portable across machines and survives extension-dir relocation.
- **Storage.** New helper `getCustomSoundsDir(globalStoragePath) => globalStorage/custom-sounds`. Created on demand. On upload, copy to a randomised name (`{type}-{nanoid(6)}.{ext}`) so the URI changes and `use-sound` re-creates the `Howl`. The previous file for that slot is `unlink`'d first.
- **localResourceRoots.** Add the custom-sounds dir to the array in `resolveWebviewView()` so `asWebviewUri` resolves to a webview-accessible URL.
- **State plumbing.** Add `customSoundUris?: Partial<Record<AudioType, string>>` to `ExtensionState`. `getStateToPostToWebview()` resolves each non-empty setting via `webview.asWebviewUri(...).toString()` (returns `undefined` if the file doesn't exist on disk — handles stale settings).
- **Messages.** Two new `WebviewMessage` types: `"selectCustomSound"` (with `audioType`) and `"resetCustomSound"` (with `audioType`). Extension-side handlers wrap the dialog/copy/unlink. `audioType` field already exists on `WebviewMessage` (used by `playSound`).
- **UI.** `NotificationSettings` gets a sub-section per `AudioType` rendered only when `soundEnabled`. Each row: label, current state ("Default" or filename), "Choose…" + "Reset". Browse button posts `selectCustomSound`. Reset button posts `resetCustomSound`. Reads `customSoundUris` from `useExtensionState`. Duration validation lives here: when a non-empty `customSoundUris[type]` becomes visible, a hidden `<audio>` loads it, and `loadedmetadata` checks `duration > 10`; if so, post `resetCustomSound` + toast.
- **ChatView.** Read `customSoundUris` from `useExtensionState`. Pick `customSoundUris[type] ?? \`${audioBaseUri}/${name}.wav\``for each`useSound`call.`use-sound`'s effect rebuilds the `Howl`when`src` changes — no manual cache invalidation needed.
- **CSP.** `media-src ${webview.cspSource}` already permits webview-hosted URIs, including custom-sounds dir, once it's a `localResourceRoot`. No CSP change needed.
- **Why not data URIs in settings.** A 100 KB WAV → 130 KB base64 in every state push, plus per-keystroke setting writes. Heavy and brittle. File copy keeps settings small and replicates the built-in pipeline.
- **Why per-upload random name.** Same filename = same URL = `use-sound` keeps cached `Howl`. Random suffix forces re-init when the user picks a new file with the same name.

## 5. File Changes

| Action | File Path                                                     | Brief Purpose                                                                                                                                               |
| :----- | :------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD    | `packages/types/src/global-settings.ts`                       | Add 3 `customSound*` optional string fields.                                                                                                                |
| MOD    | `packages/types/src/vscode-extension-host.ts`                 | Add `"selectCustomSound" \| "resetCustomSound"` to `WebviewMessage.type`. Add `customSoundUris?` field to `ExtensionState`. Add `audioType` already exists. |
| ADD    | `src/integrations/misc/custom-sounds.ts`                      | `getCustomSoundsDir`, `selectAndStoreCustomSound`, `resetCustomSound`, `resolveCustomSoundUri(webview, …)`. Pure utility module.                            |
| MOD    | `src/core/webview/ClineProvider.ts`                           | Add custom-sounds dir to `localResourceRoots`. In `getStateToPostToWebview()`, build `customSoundUris` map via `resolveCustomSoundUri`.                     |
| MOD    | `src/core/webview/webviewMessageHandler.ts`                   | Two new `case` branches dispatching to the helper, then `postStateToWebview()`.                                                                             |
| MOD    | `webview-ui/src/context/ExtensionStateContext.tsx`            | Type already extends `ExtensionState`, so the field flows through automatically — no change unless we add an initial `{}`.                                  |
| MOD    | `webview-ui/src/components/settings/NotificationSettings.tsx` | New props (`customSoundUris`), 3 chooser rows under the existing volume slider with browse + reset + duration warning.                                      |
| MOD    | `webview-ui/src/components/settings/SettingsView.tsx`         | Pull `customSoundUris` from `useExtensionState` and pass to `NotificationSettings`.                                                                         |
| MOD    | `webview-ui/src/components/chat/ChatView.tsx`                 | Prefer `customSoundUris[type]` when constructing `useSound` URLs.                                                                                           |
| MOD    | `webview-ui/src/i18n/locales/en/settings.json`                | New keys under `notifications.sound.custom.*` (label, choose, reset, default, tooLong toast, fileTypes).                                                    |

Blast radius: contained. No change to existing built-in behaviour when no custom file is set. Other locales fall back to English for the new keys until translated (acceptable for a community fork).

## 6. Risks

- **Settings sync.** If the user has settings sync, the basename in `customSound*` will travel to other machines where the file doesn't exist. `resolveCustomSoundUri` returns `undefined` when the file is missing, so the webview falls back silently. Acceptable.
- **`use-sound` URL change.** Library's effect re-runs only when `src` changes. Confirmed by inspecting the bundled effect. Mitigation already baked in: random filename suffix on upload.
- **Duration check is client-side, post-save.** Order is: setting stored → URL pushed → webview measures → if too long, posts reset. There is a small window where a >10 s file could play once if the user triggers an event immediately after upload. Acceptable for a settings page (the user isn't running a task at that moment) and worth the simplicity of avoiding a Node-side audio decoder dep.
- **WAV vs MP3/OGG playback in webview.** `Howler` (use-sound's backend) supports all three via HTMLAudio fallback. No format-specific code path.
- **CSP `media-src`.** Already `${webview.cspSource}` — covers all `vscode-webview-resource://` URIs once the dir is a `localResourceRoot`. Verified by re-reading both HTML templates.
- **`asWebviewUri` cache.** VS Code caches by URI string. Random-suffix filename also doubles as cache-buster across uploads.

## 7. Steps

1. **Schema first.** Add 3 fields to `globalSettingsSchema`. Run `pnpm --filter @roo-code/types build`.
2. **Types.** Extend `WebviewMessage.type` and add `customSoundUris` to `ExtensionState`.
3. **Helper module.** Implement `custom-sounds.ts` with the four pure functions. Unit-test optional.
4. **Backend wiring.** `localResourceRoots`, `getStateToPostToWebview`, two message-handler cases.
5. **Webview UI.** Extend `NotificationSettings` (props, rows, hidden `<audio>` for duration). Wire `SettingsView`.
6. **ChatView.** Prefer `customSoundUris[type]` in `useSound`.
7. **i18n.** Add `en` strings.
8. **Verification.** `pnpm --filter @roo-code/types check-types`, `pnpm --filter roo-cline check-types`, `pnpm --filter webview-ui check-types`, `pnpm --filter webview-ui lint`. Cannot test UI from this environment — note that explicitly.

## 8. Verification

- `pnpm --filter @roo-code/types check-types`
- `pnpm --filter roo-cline check-types`
- `pnpm --filter webview-ui check-types`
- `pnpm --filter webview-ui lint`

UI behaviour (file picker, duration toast, playback) requires manual testing in VS Code — flagged for the user.

## 9.-1 Follow-up fix #4 — Display the user's original filename, not the storage basename

**Symptom (reported by user):** Row showed `celebration-29d17cf5.mp3` (the randomised storage basename) instead of the file the user originally picked.

**Cause:** `selectAndStoreCustomSound` returned only the storage basename; the original filename was discarded. The storage basename has to stay randomised — `use-sound` keys its `Howl` by URL, so re-uploading a file with the same original name needs a different URL or the audio won't reload.

**Fix:** Persist both alongside each other. Added three new optional settings (`customSoundCelebrationOriginal`, `customSoundProgressLoopOriginal`, `customSoundNotificationOriginal`) and a `getCustomSoundOriginalSettingKey` helper. `selectAndStoreCustomSound` now returns `{ basename, originalName }`. The handler writes both keys (and clears both on reset). The UI prefers `*Original` for display and falls back to the storage basename for legacy values.

The user's other observation ("immediately effective, no Save needed") is the intended design — custom-sound changes flow through their own message round-trip (`selectCustomSound` / `resetCustomSound`) and never go through `setCachedStateField`, so they never dirty the Settings form.

## 9.0 Follow-up fix #3 — Reset didn't clear the basename in the UI

**Symptom (reported by user):** After uploading a custom file then clicking **Reset to default**, the row still showed `Custom: celebration-89b37efe.mp3` instead of reverting to "no custom file". Also: the user wanted the "Custom:" label / Preview / Reset controls hidden entirely when the slot is on the built-in default.

**Root cause:** `postMessage` JSON-serializes payloads, and `JSON.stringify` drops `undefined` values. After reset the extension wrote `customSoundCelebration: undefined`, the state push omitted the key entirely, and the webview merge `{ ...prevRest, ...newRest }` preserved the stale custom basename from `prevRest`. The project already handles this in `SettingsView.handleSubmit` for `allowedMaxRequests: allowedMaxRequests ?? null` — same trap.

**Fix:**

- Schema: widen the three keys from `z.string().optional()` to `z.string().nullish()` so `null` is a valid type, propagated through `GlobalSettings` and `ExtensionState`.
- `getStateToPostToWebview`: send `customSoundCelebration ?? null` (etc.) so the field is always present in the message and the merge actually clears it.
- Helper signatures (`selectAndStoreCustomSound`, `deleteCustomSound`, `resolveCustomSoundUri`) widened to accept `string | null | undefined` since the value can now be `null` at the call site.
- `NotificationSettings`: removed the "Using built-in sound" status text entirely — the row now shows nothing in that area when on default. `Preview` and `Reset` buttons were already gated on `basename`; only the `Choose…` button is visible in the default state. The unused `notifications.sound.custom.default` i18n key was deleted.

## 9.1 Follow-up fix #2 — `getState()` stripped the custom-sound fields

**Symptom:** Even after Fix #1, user reported "File is not shown on settings, nothing on dev console." Debug logs (added then removed) revealed:

```
[Extension Host] [selectCustomSound] post-update getValue: celebration-89b37efe.mp3   ← cache has it
[Extension Host] [selectCustomSound] posted state to webview
[Webview] [NotificationSettings] state custom sounds: { customSoundCelebration: undefined, … }   ← webview sees undefined
```

**Root cause:** `ClineProvider.getState()` ([src/core/webview/ClineProvider.ts:2417](src/core/webview/ClineProvider.ts#L2417)) returns an _explicit_ field list — it does NOT spread `stateValues`. `getStateToPostToWebview()` destructures `customSoundCelebration` (etc.) from the result of `getState()`, but those fields were never added to the explicit list, so the destructure yielded `undefined`. The state pushed to the webview therefore had `customSoundCelebration: undefined`, and the row UI stayed on "Default".

**Fix:** Add the three new fields to the `getState()` return object next to `soundEnabled`/`soundVolume` so they survive the explicit projection. This is the kind of trap to remember whenever a new `globalSettings` field needs to surface in the webview: it must be threaded through `getState()` AND `getStateToPostToWebview()`, not just the schema.

## 9.2 Follow-up fix #1 — UI didn't refresh after upload

**Symptom (reported by user):** "There is configuration but it doesn't take my file (I tried mp3 and wav for task complete)."

**Evidence:** After uploading, the file was correctly copied to `~/.config/Code/User/globalStorage/qub-it.tumble-code/custom-sounds/celebration-c97488d8.wav` and the setting was persisted. So the backend worked — the bug was display-only.

**Root cause:** `SettingsView` keeps its form fields in a local `cachedState` snapshot that is only re-synced from `extensionState` when the API-config name or `settingsImportedAt` changes ([webview-ui/src/components/settings/SettingsView.tsx:215-232](webview-ui/src/components/settings/SettingsView.tsx#L215-L232)). The first revision of `NotificationSettings` received `customSoundCelebration` / `customSoundProgressLoop` / `customSoundNotification` / `customSoundUris` as props through that `cachedState`, so the state push triggered by the upload never reached the row — it kept showing "Default", no Reset, no filename.

`ChatView` was unaffected because it reads `customSoundUris` directly from `useExtensionState()`, so playback would have used the new file on the next event.

**Fix:** `NotificationSettings` now reads the four custom-sound fields directly from `useExtensionState()` instead of via props ([webview-ui/src/components/settings/NotificationSettings.tsx](webview-ui/src/components/settings/NotificationSettings.tsx)). These fields are managed by their own message round-trip (`selectCustomSound` / `resetCustomSound`) and are not part of the Save-on-Done settings cache, so bypassing `cachedState` is correct. The corresponding props were removed from `SettingsView.tsx`.

## 10. Out of scope

- Per-sound volume.
- Sharing custom sounds via marketplace / cloud sync.
- Translating new i18n keys to non-English locales.
- Trimming uploaded audio to fit 10 s (we reject rather than mutate).
