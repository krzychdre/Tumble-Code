# Lazy tab after a reinstall: reload notice instead of a crash

Status: done on `fix/stale-lazy-chunk-reload`

## Touched files

- `webview-ui/src/utils/lazyTab.ts` (new): `React.lazy` wrapper and `isChunkLoadError`
- `webview-ui/src/components/common/StaleBuildNotice.tsx` (new): the notice with the Reload window button
- `webview-ui/src/App.tsx`, `webview-ui/src/components/settings/SettingsView.tsx`: the four lazy tabs use `lazyTab`
- `webview-ui/src/i18n/locales/*/common.json`: `staleBuild.*` in all 18 locales
- `packages/types/src/vscode-extension-host/debug.ts` + the message type pin spec: new `reloadWindow` message
- `src/core/webview/messageHandlers/debug.ts`: `reloadWindow` runs `workbench.action.reloadWindow`
- `webview-ui/src/utils/__tests__/lazyTab.spec.tsx` (new)

## Problem (evidence)

Opening Marketplace showed the error boundary with
`TypeError: Failed to fetch dynamically imported module: .../webview-ui/build/assets/MarketplaceView-...`.
The component stack of the running page referenced `assets/ui-st-gTDkR.js`. The installed extension directory
(`~/.vscode/extensions/qub-it.tumble-code-1.0.0`, replaced at 2026-10-03 10:37:35) only has `ui-CTHLLxdL.js`, and
its own `index.js` points at chunks that all exist. So the page was the previous build, still running after the
VSIX was reinstalled under it; the hashed chunk files it asked for were gone.

Before P4 (lazy Marketplace/Cloud/Modes/MCP chunks) everything was in `index.js`, so a stale page kept working
until reload. Since P4 the first open of a lazy tab after a reinstall fetches a file that no longer exists.

## Fix

`lazyTab` catches the rejected dynamic import. A chunk-fetch error (Chromium, Firefox and Safari wordings)
resolves to `StaleBuildNotice`, which explains that the window still runs the previous version and offers a
button posting `reloadWindow`; the host runs `workbench.action.reloadWindow`. Any other import error is rethrown
to the error boundary as before. `PlanReviewApp` in `index.tsx` stays on plain `lazy`: its panel gets fresh HTML
on every open and is not routed through the sidebar message handler.

The fix takes effect from the next install on: the page that crashed today is the old build, which does not
have the wrapper yet. Reload the window after installing a VSIX.

## Tests

`lazyTab.spec.tsx`: chunk loads, chunk missing renders the notice and posts `reloadWindow`, other errors reach
the boundary, `isChunkLoadError` wordings. Existing `AppLazyTabs.spec.tsx` and `SettingsView.lazy-tabs.spec.tsx`
still pass.
