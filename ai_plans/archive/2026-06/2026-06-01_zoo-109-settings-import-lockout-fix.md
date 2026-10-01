# Zoo PR #109 — Settings & marketplace stay inaccessible after importing settings

- **Upstream:** Zoo-Code #109, squash `1cf5a3c9e`, merged 2026-05-14 17:01, author Roomote/roomote[bot].
- **Branch:** `feature/zoo-109-settings-import-lockout` (off `main`).
- **Credit:** `Co-authored-by: Roomote <roomote@roocode.com>`.

## Problem

When a settings import downgrades/clears the active provider config, the webview's
`showWelcome` gate slams shut over the _entire_ UI. The render gate was
`return showWelcome ? <WelcomeView/> : (...)`, so Settings and Marketplace — the only
tabs that could let the user re-enter a working config — became unreachable. The user
is stranded on the welcome screen with no escape.

Despite the upstream "Roo Router" framing, this is a **provider-agnostic** UI-lockout
bug. Our fork has the identical vulnerability:

- `webview-ui/src/App.tsx` gated all tabs behind `showWelcome`.
- `src/core/config/importExport.ts` set `provider.settingsImportedAt = Date.now()` but
  never cleared it, so a stale timestamp could replay navigation on later state updates.

## Fix (4 files, all DIVERGED — applied manually, `git apply` did not match)

1. **`src/core/config/importExport.ts`** — after `postStateToWebview()`, reset
   `provider.settingsImportedAt = undefined`. The timestamp is a one-shot signal to the
   webview; clearing it stops re-launches from replaying the redirect.

2. **`webview-ui/src/App.tsx`**

    - Destructure `settingsImportedAt` from `useExtensionState()`.
    - Add `handledImportRef` to fire the recovery exactly once per import timestamp.
    - New effect: when `showWelcome && settingsImportedAt` changes and the user is not
      already on a recoverable tab (settings/marketplace), route them to
      `settings`/`providers`.
    - Render gate becomes
      `isSetupGatedTab = showWelcome && tab !== "settings" && tab !== "marketplace"`, so
      Settings and Marketplace stay reachable while onboarding still gates the rest.

3. **`src/core/config/__tests__/importExport.spec.ts`** (+) — existing "warnings" test
   now records `settingsImportedAt` as seen by `postStateToWebview` and asserts it is
   delivered once then cleared; plus a new test that the timestamp is consumed and reset.

4. **`webview-ui/src/__tests__/App.spec.tsx`** (+) — mocks `WelcomeViewProvider`; adds a
   tab-state matrix proving settings/marketplace stay reachable under the welcome gate,
   history stays gated, import fires a one-shot redirect from chat/history, and no bounce
   after the redirect has already fired.

## Tumble / fork notes

- WelcomeView import path (`./components/welcome/WelcomeViewProvider`) matches upstream;
  mock path identical.
- `settingsImportedAt` is already plumbed end-to-end in our fork (ClineProvider →
  vscode-extension-host type → ExtensionState → SettingsView), so no plumbing needed.
- No aimock artifacts involved.

## Verification

- TDD: run both updated specs; all green.
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
