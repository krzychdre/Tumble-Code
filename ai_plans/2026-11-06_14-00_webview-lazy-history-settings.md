# Webview entry chunk: History and Settings load lazily

**Status:** done on `perf/webview-lazy-tabs`
**Related:** security audit 2026-11-06, finding WO-8
**Touched:** `webview-ui/src/App.tsx`, `webview-ui/src/__tests__/AppLazyTabs.spec.tsx`

## Problem

`App.tsx` imported `HistoryView` and `SettingsView` eagerly while Marketplace and Cloud already used
`lazyTab`, so every panel start parsed the history and settings views (and what only they use) in the entry chunk.

## Fix

Both use `lazyTab` inside `Suspense` with the existing `TabLoadingFallback`. No warm-up for the welcome gate:
the chunk is a local file, the gate already renders Settings through the same path, and a chunk lost to a
reinstall shows the stale-build notice with a reload button, as for the other tabs.

## Measurement (`vite build` in the worktree)

| `assets/index.js` | raw         | gzip      |
| ----------------- | ----------- | --------- |
| before            | 1 983 632 B | 575 397 B |
| after             | 1 614 767 B | 467 038 B |

Entry chunk 18.6 % smaller. New lazy chunks: `SettingsView` 175.6 kB, `HistoryView` 15.0 kB, two `lib-*`
chunks (19.7 kB, 161.3 kB) imported only by Settings. The entry still imports only the runtime statically.

## Tests

`AppLazyTabs.spec.tsx` counts module-factory runs for settings and history too: zero on the chat tab, one
when the tab opens. Mutation: an eager `SettingsView` import makes the settings case red.
