# Zoo PR #470 — configurable diffFuzzyThreshold — DEFERRED (needs dedicated session)

Upstream: Zoo-Code-Org/Zoo-Code PR #470, commit `518bae479`, merged 2026-06-23.
Author: edelauna (+ coderabbitai bot, dropped). Fixes "Edit Unsuccessful" friction.

## Why deferred (not unsafe, but too large + diverged for an autonomous loop tick)

- **32 files / 588 insertions**: a new opt-in `diffFuzzyThreshold` setting threaded
  through types → ClineProvider → Task → the multi-search-replace diff strategy,
  plus a webview slider, SettingsView/ExtensionStateContext wiring, **18 locales**,
  and **4 test files**.
- **Plumbing anchors diverge**: Zoo threads the setting next to `rateLimitClock` in
  `Task` (TaskOptions + constructor) and at ClineProvider Task-creation sites — **our
  fork has no `rateLimitClock`**, so each of ~10 sites needs individual re-anchoring.
- The core diff-strategy change itself is **low risk** (our `multi-search-replace.ts`
  matches Zoo's pre-PR except trivial const→let; the `startLine !== undefined` →
  `startLine` change is benign with 1-based line numbers).

## Groundwork for the focused session (all diffs already analyzed)

1. `packages/types/src/global-settings.ts`: add `export const DEFAULT_DIFF_FUZZY_THRESHOLD = 1.0`
   and `diffFuzzyThreshold: z.number().min(0.5).max(1).optional()` to `globalSettingsSchema`.
   **Skip** Zoo's unrelated import-reorder at the top of that file.
2. `packages/types/src/vscode-extension-host.ts`: add `diffFuzzyThreshold: number` to `ExtensionState`.
3. `src/core/diff/strategies/multi-search-replace.ts`: import `DEFAULT_DIFF_FUZZY_THRESHOLD`;
   constructor clamps `Math.max(0.5, Math.min(1.0, fuzzyThreshold ?? DEFAULT_DIFF_FUZZY_THRESHOLD))`;
   add Levenshtein-distance / search-length diagnostics to the no-match error; new
   "Original Content" slice for the range branch.
4. `src/core/task/Task.ts`: add `diffFuzzyThreshold?: number` to `TaskOptions` and the
   constructor destructuring (anchor on `initialStatus`, NOT `rateLimitClock`), then
   `new MultiSearchReplaceDiffStrategy(diffFuzzyThreshold)`.
5. `src/core/webview/ClineProvider.ts`: destructure `diffFuzzyThreshold` from `getState()`
   at the two `createTask`/rehydrate sites and pass to `new Task({...})`; add
   `diffFuzzyThreshold: … ?? DEFAULT_DIFF_FUZZY_THRESHOLD` to getStateToPostToWebview and
   getState return objects. Re-anchor away from `rateLimitClock` lines.
6. webview: `ContextManagementSettings.tsx` (Slider 0.5–1.0 step 0.01 under a new
   `fileEdits.diffFuzzyThreshold` SearchableSetting), `SettingsView.tsx` (destructure +
   pass prop + include in save payload), `ExtensionStateContext.tsx` (default).
7. i18n: add `contextManagement.fileEdits.diffFuzzyThreshold.{label,description}` to all
   18 `settings.json` locales (en text in the PR).
8. Tests: `multi-search-replace.spec.ts` (+218, diagnostics/clamp), `ClineProvider.spec.ts`
   (+54, passthrough), `single-open-invariant.spec.ts` (+40), `ContextManagementSettings.spec.tsx`
   (+21), `SettingsView.spec.tsx` (+38), `ExtensionStateContext.spec.tsx` (+3).

Credit on port: `Co-authored-by: Elliott de Launay <edelauna@gmail.com>`.
