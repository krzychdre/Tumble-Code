# Lazy Shiki theme loading (webview-ui)

**Branch:** `perf/lazy-shiki-themes` (off `main` @ `7b4338b89`, 2026-09-26)
**Scope:** webview-ui only. Follow-up from the 2026-09-24 refactor master plan.

## Motivation

`webview-ui/src/utils/highlighter.ts` called `createHighlighter({ themes: Object.keys(bundledThemes), ... })` at webview startup — registering **all 65 bundled Shiki themes** even though a repo-wide search shows only two themes are ever requested:

- `CodeBlock.tsx` → `github-light` / `github-dark` (from the VS Code body class)
- `highlightDiff.ts` → same pair (from its `light | dark` prop)

The startup pre-warm in `index.tsx` (`getHighlighter()`) triggered this at webview boot.

### Evidence (before)

Shiki v4's `bundledThemes` are `DynamicImportThemeRegistration`s — theme modules are code-split chunks, not in the main bundle — but passing the full key list to `createHighlighter` makes it **await and evaluate all 65 dynamic imports** during the startup await. Measured with `/tmp/shiki-bench.mjs` (Node 22, shiki 4.4.3 from `webview-ui/node_modules`, 3 runs, after a warm-up createHighlighter so module loading isn't counted):

| Scenario                                                                                       | init await          |
| ---------------------------------------------------------------------------------------------- | ------------------- |
| `createHighlighter({ themes: all 65 })`                                                        | **43 / 52 / 51 ms** |
| `createHighlighter({ themes: [] })`                                                            | 1 / 1 / 0 ms        |
| `createHighlighter({ themes: [] })` + `loadTheme("github-light")` + `loadTheme("github-dark")` | 1 / 2 / 2 ms        |

So ~50 ms of the webview's Shiki startup await was spent registering 63 themes that are never used. (The CLI was checked too: `apps/cli` has **no** shiki dependency — its colored diffs come from its own `theme.diffAdded`/`diffRemoved` ink colors — so nothing to do there.)

### Evidence (after)

`createHighlighter` is now called with `themes: []`; `highlighter.loadTheme()` resolves the theme's dynamic import on first request. The two used themes cost ~1–2 ms combined, and only the one matching the active VS Code theme is loaded at startup. Bundle output is unchanged structurally (theme chunks were already dynamic-import chunks; they're just no longer all evaluated at boot).

## Approach

1. **`highlighter.ts`** — `getHighlighter(language?, theme?)` gains an optional `ShikiThemeName` (`"github-light" | "github-dark"`, the only names call sites use) parameter. `createHighlighter` registers zero themes; a new `ensureTheme()` mirrors the existing `ensureLanguage()` pending-map deduplication: concurrent requests for the same theme share one promise, and the pending entry is removed in `finally` **including on failure**, so a later render retries the load. Exported `isThemeLoaded()` for symmetry with `isLanguageLoaded()`. The unused `BundledTheme` import and the dead `LANGUAGE_LOAD_DELAY` test constant were dropped.
2. **`CodeBlock.tsx`** — resolves the theme name once per highlight pass and passes it to `getHighlighter`; `codeToHast` uses the same variable (behavior identical).
3. **`highlightDiff.ts`** — resolves `github-light`/`github-dark` from its existing `light | dark` prop and passes it to `getHighlighter`.
4. **`index.tsx`** — the startup pre-warm keeps hiding first-code-block latency but now passes only the theme matching the current VS Code body class.

## Edge cases

- **Theme switching (light ⇄ dark):** `CodeBlock` re-runs its highlight effect when the webview re-renders after a VS Code theme change; the new theme name flows into `getHighlighter` and `ensureTheme` loads it on demand (~1 ms, once). No flicker regression: the fallback plain-text path is unchanged.
- **First paint:** unchanged — `CodeBlock` already renders a plain-text fallback while the highlighter/theme/language load; the golden spec confirms the final highlighted HTML is byte-identical.
- **Theme load failure:** `ensureTheme` logs and rethrows; `CodeBlock`/`highlightHunks` already catch any `getHighlighter` rejection and fall back to plain text. The failed pending entry is cleared so the next render retries instead of caching the failure.
- **Concurrent first renders:** many code blocks mounting at once all request the same theme → one `loadTheme` call via the pending map (unit-tested).
- **Languages:** left as-is. They were already lazy (`loadLanguage` per request, initial `["shell", "log"]`); the 346 bundled languages are dynamic-import registrations and were never all evaluated.

## Tests

- New `webview-ui/src/utils/__tests__/highlighter.spec.ts` (9 tests, mocked `shiki` module, fresh module import per test since the highlighter is a singleton): asserts `createHighlighter` gets `themes: []`, per-theme on-demand loading, load-once, theme-switch load, concurrent dedup, singleton reuse, no-theme path, failed-load retry, and language lazy-dedup behavior.
- Updated two assertions in existing specs to the new `getHighlighter(lang, theme)` contract: `CodeBlock.spec.tsx` and `highlightDiff.spec.ts`.
- `CodeBlock.shiki-golden.spec.tsx` (real Shiki, golden HTML) passes **unchanged** — proof the rendered output is identical under lazy themes.
- `index.spec.tsx` passes unchanged.

## Verification

- `cd webview-ui && npx vitest run` targeted specs: 66/66 green.
- `pnpm run lint` (pre-commit, all workspaces): green.
- `tsc` / knip: see PR checks — run before merge.

## Deferred

- Mermaid/katex remain separate from this path.
- If a future feature needs more Shiki themes, `ShikiThemeName` and the call sites are the only places to extend.
