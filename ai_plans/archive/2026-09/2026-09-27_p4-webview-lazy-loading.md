# P4 — Lazy-load heavy webview assets

Roadmap item P4 of [2026-09-27_simplification-roadmap.md](2026-09-27_simplification-roadmap.md):
the initial chat view should load lean. Three eager loads are moved behind
lazy barriers:

1. **KaTeX CSS** — into the existing math lazy loader in MarkdownBlock.
2. **posthog-js** — dynamic import, executed only when telemetry is enabled.
3. **React.lazy for non-chat tabs** — Marketplace, Cloud (App tabs) and
   Modes, MCP (Settings tabs).

## Stacking decision: STACK on feature/p3-dedup-webviewdidlaunch

`git diff --name-only main feature/p3-dedup-webviewdidlaunch`:

```
.changeset/p3-dedup-webviewdidlaunch.md
ai_plans/2026-09-27_p3-dedup-webviewdidlaunch.md
webview-ui/src/App.tsx
webview-ui/src/__tests__/AppLaunch.spec.tsx
```

P3's only product edit is in `webview-ui/src/App.tsx` (removal of the duplicate
launch post). Item 3 of P4 edits the exact same file (the tab switch block,
App.tsx:245-263) — the file overlap is direct, not incidental. Branching off
main would make P3 and P4 collide in App.tsx on the first rebase/merge.
`feature/p4-webview-lazy-loading` therefore branches off
`feature/p3-dedup-webviewdidlaunch` and will rebase cleanly onto main after P3
merges (P3's diff is 4 deleted lines elsewhere in the file; no overlap with the
tab block).

## Item 1 — KaTeX CSS into the lazy loader

### Current eager-load evidence

- `webview-ui/src/index.css:21` — `@import "katex/dist/katex.min.css";` is
  imported unconditionally from `webview-ui/src/index.tsx:4`
  (`import "./index.css"`), so the ~23 KB (min) stylesheet plus its font
  URL references load on every webview boot even though math almost never
  renders.
- The JS side is already lazy: `webview-ui/src/components/common/MarkdownBlock.tsx:36-55`
  defines `loadRehypeKatex()`, which `import("rehype-katex")` only when a
  markdown string contains `$` (`useRehypeKatex`, MarkdownBlock.tsx:67-78).
  `webview-ui/src/components/common/__tests__/MarkdownBlock.spec.tsx:6-11`
  already pins that the import counter stays 0 for math-free markdown.

### Why the stylesheet is eagerly loaded today

`webview-ui/vite.config.ts:117` sets `cssCodeSplit: false` and
`vite.config.ts:139-142` renames every CSS asset to `assets/index.css`: all CSS
in the graph is merged into one bundle that `src/core/webview/WebviewHtml.ts:46`
loads via a `<link>` in the static HTML. A `@import` in index.css is simply
inlined there.

### Design

The CSS must become its own chunk that is only fetched when `loadRehypeKatex()`
runs:

- Remove `@import "katex/dist/katex.min.css"` from `index.css`.
- In `vite.config.ts`, stop force-merging ALL css: `cssCodeSplit: false` was
  chosen "so all webviews share styles"; the sharing only needs the _entry_
  CSS to keep the `assets/index.css` name that `WebviewHtml.ts` links. Vite's
  `cssCodeSplit: true` splits per-chunk CSS; the entry chunk's CSS asset keeps
  the name `assets/index.css` through the existing `assetFileNames` callback
  (`vite.config.ts:139-142`), so `WebviewHtml.ts` needs **no change** and the
  entry stylesheet keeps working for both the sidebar and the plan-review
  webview.
- In `MarkdownBlock.tsx`, extend `loadRehypeKatex()` to also load the KaTeX
  stylesheet: a parallel dynamic `import("katex/dist/katex.min.css")` (Vite
  turns a dynamic CSS import into a chunk that injects a `<link rel=stylesheet>`
  at runtime). CSP check: `WebviewHtml.ts:80` production CSP allows
  `style-src ${csp} 'unsafe-inline'`; chunk-loaded CSS resolves to a
  `vscode-webview://` URL (= csp), same origin as the fonts `font-src ${csp}`
  already permits — the locale JSON chunks already prove chunk fetching works
  inside the webview CSP.

Renders stay correct while the stylesheet is in flight because rehype-katex's
JS and the CSS load in the same `loadRehypeKatex()` barrier: the listener
notifies only after both promises settle.

### KaTeX fonts

`katex.min.css` references its WOFF2 fonts by relative URL; Vite emits those as
`assets/fonts/[name][extname]` (existing rule, `vite.config.ts:144-146`) and
rewrites the URLs inside the chunk CSS, so the font URLs follow the chunk and
stay inside the webview origin. No action needed beyond keeping the rule.

### Tests

- Existing: `MarkdownBlock.spec.tsx` already asserts rehype-katex is not
  imported for math-free markdown; extend the same spec with a counter for
  `katex/dist/katex.min.css` asserting it is imported **once, together with**
  rehype-katex on first math content, and zero times for math-free content.
- `katex-styles.spec.tsx` reads the stylesheet from
  `node_modules/katex/dist/katex.min.css` directly (not from the bundle), so it
  is unaffected by the @import removal; only its header comment mentions
  index.css and gets a small correction.
- Build-level proof (not unit-testable in jsdom): after `pnpm turbo bundle`,
  `src/webview-ui/build/assets/index.css` must NOT contain `.katex` rules and a
  new `assets/katex*.css` chunk must exist. Run once locally and record sizes.

## Item 2 — posthog-js behind telemetry gate

### Current eager-load evidence

- `webview-ui/src/utils/TelemetryClient.ts:1` — `import posthog from "posthog-js"`
  at module top level. `TelemetryClient` is imported by App.tsx:11 and 8 more
  modules (ErrorBoundary, ChatView's ModeSelector/ShareButton, CloudView,
  MarketplaceItemCard, DismissibleUpsell, UISettings, useCloudUpsell) — i.e.
  posthog-js sits on the chat critical path. With telemetry off (the default
  via `telemetrySetting: unset`), the whole ~120 KB library is still parsed.

### Design

`TelemetryClient` holds a module handle instead of the module:

```ts
type Posthog = (typeof import("posthog-js"))["default"]
let posthog: Posthog | undefined
let posthogLoad: Promise<Posthog> | undefined
```

- `updateTelemetryState(telemetrySetting, apiKey?, distinctId?)`:
    - When telemetry is disabled/unset: set `telemetryEnabled = false`. **Do not
      import**; nothing is fetched. (posthog.reset() is dropped for the
      disabled path — reset is only meaningful for a previously loaded instance;
      when the module was never fetched there is nothing to reset, and when it
      was loaded, abandoning `capture` via the flag is equivalent for our
      single-tenant use.)
    - When enabled AND apiKey AND distinctId: `posthogLoad ??= import("posthog-js")`
      then `.then((module) => { posthog = module.default; posthog.init(...);
posthog.identify(distinctId) })`. `telemetryEnabled` flips true only
      after the load resolves (init'd), so an early `capture()` cannot fire
      before init. Queuing captured events during load is unnecessary: startup
      events are not contractual (existing behavior already silently drops
      events on capture errors, TelemetryClient.ts:41-43).
    - If telemetry flips from enabled to disabled later, set
      `telemetryEnabled = false`; if the module had loaded, call
      `posthog.reset()` on the loaded handle (keeps the old semantics of the
      disabled transition).
- `capture()`: unchanged guard (`telemetryEnabled`), plus a `posthog &&`
  check; still wrapped in try/catch.

The "never even fetched when telemetry is off" claim: with a top-level static
import, Vite puts posthog-js in the entry chunk; a dynamic `import()` creates a
separate chunk whose fetch is only triggered by executing the import call —
which the gate prevents. CSP is irrelevant here (no network; the chunk is same
origin, same as locale chunks).

### Tests

`webview-ui/src/__tests__/TelemetryClient.spec.ts` and
`webview-ui/src/utils/__tests__/TelemetryClient.spec.ts` both `vi.mock("posthog-js")`
statically. With a dynamic import, `vi.mock` still intercepts dynamic imports
of the same specifier (vitest resolves the mock for `import()` too), but the
tests import `posthog` at top to assert — that import would itself trigger the
mock fine; the real change is the tests must become async:

- Assert `import("posthog-js")` is NOT called when `updateTelemetryState("disabled" | "unset")`
  — mock with a factory that counts invocations (the factory runs when the
  module is first requested by ANY import; a `vi.fn()` inside a hoisted
  counter, same pattern as MarkdownBlock.spec.tsx's importCounts).
- Assert init/identify happen when enabled with key+id, awaited.
- Assert `capture` before the load resolves does not throw and does not
  capture.
- Remove the now-false "resets PostHog when called" expectations (reset only
  happens on the enabled→disabled transition of a loaded instance) — replace
  with a transition test.

Two spec files cover the same class twice (history); both get updated, no
deletions in this scope.

## Item 3 — React.lazy for non-chat tabs

### Current eager-load evidence

- `webview-ui/src/App.tsx:18` — `import { MarketplaceView }`
- `webview-ui/src/App.tsx:22` — `import { CloudView }`
- `webview-ui/src/components/settings/SettingsView.tsx:66-67` —
  `import ModesView from "../modes/ModesView"` (1264 lines) and
  `import McpView from "../mcp/McpView"` (547 lines). SettingsView itself is
  eagerly imported by App.tsx:16, so all four land in the entry chunk with the
  chat view.

### Design

- In `App.tsx`, replace the static imports with
  `const MarketplaceView = lazy(() => import("./components/marketplace/MarketplaceView").then(m => ({ default: m.MarketplaceView })))`
  (named export) and `const CloudView = lazy(() => import("./components/cloud/CloudView").then(m => ({ default: m.CloudView })))`.
  Wrap each conditional render in `<Suspense fallback={<TabLoadingFallback />}>`.
  Fallback = `<ThemedProgressRing />` (the codebase's standard loading
  indicator, `webview-ui/src/components/ui/themed-progress-ring.tsx`) centered
  in the tab area with the existing `VSCodePanelView`-free minimal wrapper
  (a `div` with the same flex classes the Tab content uses), kept subtle.
- In `SettingsView.tsx`, same treatment for `ModesView` and `McpView` around
  the `{renderTab === "modes"}` / `{renderTab === "mcp"}` blocks
  (SettingsView.tsx:653-664). The `onSelectApiConfiguration` prop wiring is
  untouched.
- NOT lazy (deliberately): `HistoryView`, `SettingsView`, `WelcomeView`,
  `ChatView`, the dialogs. Settings is reachable during welcome gating
  (App.tsx:240, comment: keep Settings and Marketplace reachable while
  onboarding gates the UI) and is the recovery path for imported configs
  (App.tsx:184-194) — first click must be instant, and SettingsView hosts a
  dozen other sections that remain eager anyway. Marketplace is lazy in the
  bundle sense but still reachable through the welcome gate; lazy loading it
  only defers one fetch, and Suspense handles the wait fine — consistent with
  the roadmap's explicit "Marketplace, Cloud, Modes, MCP" list.
- `SettingsViewRef.checkUnsaveChanges` interplay: the ref lives on
  SettingsView itself, which stays eager — no interaction with the lazy
  children.

### Tests

- `App.spec.tsx` already mocks all four modules with `vi.mock` — `React.lazy`
  around a dynamically imported mocked module still works (vitest intercepts
  the dynamic import), but the renders become async: assertions switch from
  `screen.getByTestId` to `findByTestId` where they target the four views.
- New spec `webview-ui/src/__tests__/AppLazyTabs.spec.tsx` proving the laziness
  claim at the lowest layer: render AppWithProviders (mocked state provider as
  in App.spec.tsx), assert the MarketplaceView/CloudView module factories were
  NOT invoked while on the chat tab, then trigger `marketplaceButtonClicked`
  and assert the factory was invoked exactly once and the view appears.
  Pattern: hoisted import counters via `vi.mock` factories (same as
  MarkdownBlock.spec.tsx importCounts).
- Analogous low-cost additions inside the existing
  `SettingsView.unsaved-changes.spec.tsx` family are skipped: ModesView/McpView
  are already mocked there; instead one focused new spec
  `webview-ui/src/components/settings/__tests__/SettingsView.lazy-tabs.spec.tsx`
  pins that the Modes/MCP module factories are not touched until their
  `renderTab` is selected.

## Verification (actual results)

- Item 1 unit-proof: `MarkdownBlock.spec.tsx` "lazy KaTeX and Mermaid" now
  also counts `katex/dist/katex.min.css` fetches — 0 for math-free markdown,
  1 together with rehype-katex on first math content. **77 tests green**
  across the three MarkdownBlock/katex specs.
- Item 2 unit-proof: both TelemetryClient specs rewritten around
  `vi.doMock` fetch counters (hoisted `vi.mock` factories do NOT re-run for
  dynamic imports after `vi.resetModules()` — that was the hard-won lesson):
  `fetches.count === 0` after disabled/unset/partial-cred updates; `=== 1`
  and init'd after an enabled update; capture dropped during load;
  enabled->disabled resets a loaded instance. **15 tests green.**
- Item 3 unit-proof: new `AppLazyTabs.spec.tsx` (4 tests) pins
  factory-not-invoked on the chat tab, exactly-once fetch on tab open, and
  the `tab-loading` fallback via a never-resolving chunk; new
  `SettingsView.lazy-tabs.spec.tsx` (3 tests) pins at-most-once fetch for
  Modes/MCP (SettingsView's search indexing mounts every tab once on
  startup, so "at most once, never at module scope" is the strongest true
  claim) and the fallback. **All green.**
- Mock updates required by the lazy changes: the three SettingsView
  unsaved-changes/change-detection/save-defaults specs and
  `SettingsView.spec.tsx` stub the `@src/components/ui` barrel and needed a
  `ThemedProgressRing` stub for the new fallback. App/Cloud specs needed
  nothing (their `vi.mock` of the lazy modules still intercepts the dynamic
  import; the existing `findByTestId` calls already awaited Suspense).
- `pnpm check-types`: clean. `pnpm lint`: clean (compiler bailouts match
  the 8-known baseline). `pnpm knip`: byte-identical to the pre-change
  baseline (exit 1 pre-existing, 0 new findings).
- Full webview-ui suite: **3014/3014 passed** (~104 s), including P3's
  AppLaunch.spec.tsx (stack intact).
- Bundle proof (`pnpm build`, output `src/webview-ui/build/assets/`):
    - `index.css` (128 KB) contains **0** `.katex` rules; the KaTeX stylesheet
      is its own chunk `katex-BUUrzxgb.css` (29 KB) loaded by the markdown
      math path, with its fonts still under `assets/fonts/`.
    - `posthog-js` (157 KB) moved out of the entry chunk into
      `module-DQXllHz0.js`, fetched only by the telemetry gate. The entry
      `index.js` keeps only the TelemetryClient wrapper.
    - New lazy view chunks: `MarketplaceView-DPhj92oE.js` (30 KB),
      `CloudView-DOXyqjGW.js` (10 KB), `McpView-CsBeKRjL.js` (33 KB),
      `ModesView-CU1UmAAW.js` (53 KB).
    - The entry stylesheet keeps the fixed `assets/index.css` name via the
      `assetFileNames` callback (its `originalFileNames` entry is the HTML
      entry, `index.html`), so `WebviewHtml.ts` needed no change.

## Verification (plan)

- `cd webview-ui && npx vitest run` for: MarkdownBlock.spec.tsx,
  MarkdownBlock.golden-renders.spec.tsx, katex-styles.spec.tsx, both
  TelemetryClient specs, App.spec.tsx, AppLaunch.spec.tsx (P3's, must stay
  green — stacking proof), new AppLazyTabs.spec.tsx,
  SettingsView.lazy-tabs.spec.tsx, CloudView.spec.tsx, plus the SettingsView
  spec family (they render ModesView/McpView mocks).
- `pnpm check-types` + `pnpm lint` (webview-ui scope).
- `pnpm knip` — no NEW findings vs the pre-existing exit-1 baseline (capture
  baseline before edits, diff after).
- Bundle proof: `pnpm turbo bundle` (or `pnpm --filter @roo-code/vscode-webview
build`) once at the end; record that (a) `assets/index.css` no longer
  contains `.katex`, (b) a katex CSS chunk + posthog chunk + 4 view chunks
  exist, (c) entry chunk size delta.

## Acceptance criteria

1. `katex/dist/katex.min.css` is absent from the entry CSS bundle and loaded
   only when math content first renders (unit-proven via import counter).
2. `posthog-js` is absent from the entry JS chunk; the module is not fetched
   when telemetry is disabled/unset (unit-proven via mock factory counter).
3. Marketplace/Cloud/Modes/McpView are separate chunks fetched on first tab
   open (unit-proven for the factory-not-invoked-until-open claim).
4. Chat view + SettingsView + HistoryView + dialogs stay eager.
5. All touched specs green; check-types, lint clean; knip delta = 0 new
   findings; P3's AppLaunch.spec.tsx still green (stack intact).
6. Changeset: patch for @roo-code/vscode-webview.

## Deliberately left eager (with reasons)

- `codicon.css`, `index.css` entry, Shiki pre-warm (`index.tsx:11-19`): Shiki
  is needed for the first code block in chat, which is the primary view;
  codicons and entry styles are used by the initial shell.
- `HistoryView`: rendered from the chat header's history button with user
  expectation of instant open, and modest size; not on the roadmap list.
- `SettingsView` (as a whole): welcome-gate recovery path + hosts many eager
  sections; only its Modes/MCP sub-tabs go lazy, per the roadmap wording.
