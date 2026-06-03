# Remove Text-to-Speech (TTS) — full removal plan

**Date:** 2026-05-27
**Branch:** `feat/remove-tts` (stacked on `feat/custom-sound-effects`)
**Status:** Draft

## 1. Objective

Tear out the entire TTS feature: the "Enable text-to-speech" toggle + speed slider in Notification settings, the host-side `say` integration, the auto-speak hook in `ChatView`, and the `ttsStart`/`ttsStop` indicator in `ChatTextArea`. No deprecation shims, no migration — old `ttsEnabled` / `ttsSpeed` values that linger in user globalState are simply ignored (they're just unread keys; nothing else reads them).

## 2. Evidence (Current Behavior)

- **Host runtime.** [src/utils/tts.ts](src/utils/tts.ts) wraps the `say` npm package: `setTtsEnabled`, `setTtsSpeed`, `playTts`, `stopTts`, and an internal utterance queue.
- **Host wiring.** [src/core/webview/ClineProvider.ts:82](src/core/webview/ClineProvider.ts#L82) imports `setTtsEnabled` / `setTtsSpeed`. [src/core/webview/ClineProvider.ts:856-868](src/core/webview/ClineProvider.ts#L856-L868) restores them at boot from globalState. [src/core/webview/ClineProvider.ts:2170-2171](src/core/webview/ClineProvider.ts#L2170-L2171) and [:2317-2318](src/core/webview/ClineProvider.ts#L2317-L2318) include `ttsEnabled`/`ttsSpeed` in `getStateToPostToWebview()`. [:2553-2554](src/core/webview/ClineProvider.ts#L2553-L2554) re-emits them in `getState()`.
- **Host message handler.** [src/core/webview/webviewMessageHandler.ts:65](src/core/webview/webviewMessageHandler.ts#L65) imports `playTts`/`setTtsEnabled`/`setTtsSpeed`/`stopTts`. [:690-695](src/core/webview/webviewMessageHandler.ts#L690-L695) handles `updateSettings`-driven changes. [:1510-1533](src/core/webview/webviewMessageHandler.ts#L1510-L1533) handles four message types: `ttsEnabled`, `ttsSpeed`, `playTts`, `stopTts` (note: `stopTts` is never sent by the webview today — dead path).
- **Schema.** [packages/types/src/global-settings.ts:158-159](packages/types/src/global-settings.ts#L158-L159) (`ttsEnabled`, `ttsSpeed`), defaults at [:359-360](packages/types/src/global-settings.ts#L359-L360).
- **Message-type unions.** [packages/types/src/vscode-extension-host.ts:62-63](packages/types/src/vscode-extension-host.ts#L62-L63) (`"ttsStart" | "ttsStop"` on `ExtensionMessage`), [:271-272](packages/types/src/vscode-extension-host.ts#L271-L272) (cached-state-field key union), [:469-472](packages/types/src/vscode-extension-host.ts#L469-L472) (`"playTts" | "stopTts" | "ttsEnabled" | "ttsSpeed"` on `WebviewMessage`).
- **Webview state.** [webview-ui/src/context/ExtensionStateContext.tsx:203-204](webview-ui/src/context/ExtensionStateContext.tsx#L203-L204) (defaults), [:495](webview-ui/src/context/ExtensionStateContext.tsx#L495) (exposed via context), [:531-532](webview-ui/src/context/ExtensionStateContext.tsx#L531-L532) (`setTtsEnabled` / `setTtsSpeed` setters).
- **Settings UI.** [webview-ui/src/components/settings/NotificationSettings.tsx:38-42](webview-ui/src/components/settings/NotificationSettings.tsx#L38-L42), [:133-134](webview-ui/src/components/settings/NotificationSettings.tsx#L133-L134), [:173-210](webview-ui/src/components/settings/NotificationSettings.tsx#L173-L210) (whole TTS sub-section). Wired in [webview-ui/src/components/settings/SettingsView.tsx:173-174](webview-ui/src/components/settings/SettingsView.tsx#L173-L174), [:386-387](webview-ui/src/components/settings/SettingsView.tsx#L386-L387), [:820-821](webview-ui/src/components/settings/SettingsView.tsx#L820-L821).
- **ChatView playback hook.** [webview-ui/src/components/chat/ChatView.tsx:271-273](webview-ui/src/components/chat/ChatView.tsx#L271-L273) defines the local `playTts(text)` poster. [:1096-1112](webview-ui/src/components/chat/ChatView.tsx#L1096-L1112) is the inline block that strips mermaid + markdown and posts `playTts` for each new assistant text/completion message; it relies on a local `lastTtsRef` to dedupe.
- **ChatTextArea indicator.** [webview-ui/src/components/chat/ChatTextArea.tsx:916-926](webview-ui/src/components/chat/ChatTextArea.tsx#L916-L926) tracks `isTtsPlaying` from `ttsStart`/`ttsStop`. Note: `isTtsPlaying` is **set but not read** anywhere in this component today — it's already dead UI.
- **Locales.** Every locale's `settings.json` has a `notifications.tts.{label,description,speedLabel}` block; 17 locales total (ca, de, en, es, fr, hi, id, it, ja, ko, nl, pl, pt-BR, ru, tr, vi, zh-CN, zh-TW).
- **Tests.** ClineProvider specs mock `../../../utils/tts`; SettingsView spec has 4 tts-related test cases plus default-state fixtures.
- **Dependency.** `say@^0.16.0` in [src/package.json:521](src/package.json#L521). No `@types/say`. Pulls in a transitive chain via pnpm; lock will regenerate after `pnpm install`.

## 3. Target Behavior

| Scenario                                                              | Result                                                                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notifications settings page                                           | No "Enable text-to-speech" row, no speed slider. Sound + custom-sound rows remain (those belong to the stacked custom-sound-effects work).                      |
| Assistant completes / sends text                                      | Webview no longer posts `playTts`. No host-side speech.                                                                                                         |
| Existing user with `ttsEnabled: true` in globalState                  | Value is silently ignored. No UI to surface or change it. (Stale keys are harmless — `contextProxy` doesn't validate the schema; removed keys just sit unread.) |
| Existing `ttsStart`/`ttsStop` listener in custom webview integrations | None exists outside `ChatTextArea`. Internal-only, safe to drop.                                                                                                |

## 4. Tech Strategy

- **Pure deletion, no compatibility layer.** Both schema fields and all four `WebviewMessage` types disappear. Reasoning: this is a community-fork rebrand; we are not maintaining wire compatibility with upstream, and no external clients consume these messages.
- **Stacked branch.** Files overlap heavily with `feat/custom-sound-effects` (NotificationSettings.tsx, ClineProvider.ts, webviewMessageHandler.ts, schemas, ChatView.tsx). New branch `feat/remove-tts` was created from current `feat/custom-sound-effects` HEAD so the eventual rebase/merge order is: custom-sound-effects → remove-tts. The custom-sound-effects WIP currently riding the working tree is intentionally not committed by this work — the user will commit it on the parent branch.
- **Why ChatTextArea's listener is safe to drop.** `isTtsPlaying` is set by the message listener but never read. The block is dead state already, so removing it has zero behavior change.
- **Test cleanup.** SettingsView.spec.tsx has four TTS-specific test cases (default-off, toggle, slider-visibility, speed-change). All removed wholesale; replacement coverage is not needed because there is no replacement feature.
- **Locale parity.** All 17 locales lose the `tts` key. Other locale top-level structure is untouched (closing brace of `notifications` re-grounds on the next key — currently `sound` or — in some files — the next section. We need to make sure each locale's surrounding JSON stays valid.).
- **Dependency removal.** Drop `say` from [src/package.json](src/package.json) only. Lockfile will need a `pnpm install` (left to the user; not run as part of this branch to keep the diff reviewable).

## 5. File Changes

| Action | Path                                                                                  | Purpose                                                                                                                                                                              |
| :----- | :------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD    | `packages/types/src/global-settings.ts`                                               | Drop `ttsEnabled`, `ttsSpeed` schema fields + defaults.                                                                                                                              |
| MOD    | `packages/types/src/vscode-extension-host.ts`                                         | Drop `ttsStart`/`ttsStop` from `ExtensionMessage`, `playTts`/`stopTts`/`ttsEnabled`/`ttsSpeed` from `WebviewMessage`, `ttsEnabled`/`ttsSpeed` from the cached-state-field key union. |
| DEL    | `src/utils/tts.ts`                                                                    | Module no longer needed.                                                                                                                                                             |
| MOD    | `src/core/webview/ClineProvider.ts`                                                   | Drop `setTtsEnabled`/`setTtsSpeed` import, boot-time restore, and inclusion in `getStateToPostToWebview()` / `getState()`.                                                           |
| MOD    | `src/core/webview/webviewMessageHandler.ts`                                           | Drop `tts` import, the `updateSettings` branches, and the four message-type cases.                                                                                                   |
| MOD    | `webview-ui/src/components/settings/NotificationSettings.tsx`                         | Drop props, destructure, and the entire TTS `SearchableSetting` block.                                                                                                               |
| MOD    | `webview-ui/src/components/settings/SettingsView.tsx`                                 | Drop destructure, `setCachedState`-payload entries, and the JSX props on `<NotificationSettings>`.                                                                                   |
| MOD    | `webview-ui/src/context/ExtensionStateContext.tsx`                                    | Drop defaults, exposed `ttsSpeed`, and the two setters.                                                                                                                              |
| MOD    | `webview-ui/src/components/chat/ChatView.tsx`                                         | Drop local `playTts`, the auto-speak block on new assistant text, and the `lastTtsRef` it depends on.                                                                                |
| MOD    | `webview-ui/src/components/chat/ChatTextArea.tsx`                                     | Drop the dead `isTtsPlaying` state + listener block.                                                                                                                                 |
| MOD    | `webview-ui/src/i18n/locales/*/settings.json` (17 files)                              | Remove the `notifications.tts` block.                                                                                                                                                |
| MOD    | `src/core/webview/__tests__/ClineProvider.spec.ts`                                    | Remove `setTtsEnabled` import, the `vi.mock("../../../utils/tts")`, fixture lines, and the tts-related expectations + the toggle test.                                               |
| MOD    | `src/core/webview/__tests__/ClineProvider.apiHandlerRebuild.spec.ts`                  | Remove `vi.mock("../../../utils/tts")`.                                                                                                                                              |
| MOD    | `src/core/webview/__tests__/ClineProvider.taskHistory.spec.ts`                        | Same.                                                                                                                                                                                |
| MOD    | `webview-ui/src/components/settings/__tests__/SettingsView.change-detection.spec.tsx` | Remove fixture lines.                                                                                                                                                                |
| MOD    | `webview-ui/src/components/settings/__tests__/SettingsView.unsaved-changes.spec.tsx`  | Same.                                                                                                                                                                                |
| MOD    | `webview-ui/src/components/settings/__tests__/SettingsView.spec.tsx`                  | Remove fixture lines + the four TTS test cases.                                                                                                                                      |
| MOD    | `src/package.json`                                                                    | Remove `say` dependency.                                                                                                                                                             |

## 6. Risks

- **Settings sync drift.** A user who synced `ttsEnabled: true` to a machine running the new build keeps an unreferenced key in globalState. Harmless — VS Code `Memento` tolerates extra keys; we just never read it.
- **Schema validation in the parent type build.** `globalSettingsSchema.parse` ignores unknown keys by default unless `.strict()` is used. Confirmed `globalSettingsSchema` is not `.strict()` (build will pass; runtime ignores stale tts keys).
- **External integration code.** `say` is used only by `src/utils/tts.ts` — verified by grep. Safe to remove the dep.
- **Test snapshots.** None of the changed components produce snapshots that include TTS-specific output today (verified by the earlier grep).

## 7. Steps

1. **Plan doc.** (this file)
2. **Schema.** Edit `global-settings.ts`.
3. **Message types.** Edit `vscode-extension-host.ts`.
4. **Host runtime.** Delete `src/utils/tts.ts`; edit `ClineProvider.ts` and `webviewMessageHandler.ts`.
5. **Webview UI.** Edit `NotificationSettings.tsx`, `SettingsView.tsx`, `ExtensionStateContext.tsx`, `ChatView.tsx`, `ChatTextArea.tsx`.
6. **Locales.** Strip `tts` block from each locale.
7. **Tests.** Strip mocks, fixtures, and tts-specific test cases.
8. **Dependency.** Remove `say` from `src/package.json`.
9. **Verify.** `pnpm --filter @roo-code/types build`, then `pnpm -w typecheck` (or equivalent). Spot-check that the webview compiles and the SettingsView tests pass.
