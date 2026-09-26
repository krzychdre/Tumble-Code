# styled-components 6.1 → 6.4 upgrade (webview-ui)

**Date:** 2026-09-26
**Branch:** `chore/styled-components-6-4`
**Follow-up from:** docs/refactor-plan-2026-09-24.md (styled-components 6.4 was explicitly deferred from the React 19.3 upgrade, PR #515 / ai_plans/2026-09-26_react-19-3-upgrade.md).

## Version before / after

| Package | Before | After |
|---|---|---|
| `styled-components` (webview-ui) | `^6.1.13` | `~6.4.4` |

- No `@types/styled-components` existed anywhere in the monorepo (6.x ships its own TypeScript types), so nothing else to bump.
- webview-ui is the **only** workspace using styled-components (`apps/cli`, `packages/core`, `src/` are clean).
- Pinned with `~` instead of `^` deliberately: `^6.4.4` resolves to 6.5.3, which is outside the scope of this task ("latest 6.4.x"). `~` keeps us on 6.4.x per the task's requirement.

## Relevant 6.x-line changes (6.1 → 6.4)

- **React 19 support**: ref-as-prop, no more `forwardRef` deprecation warnings (the main motivation — webview-ui now runs React 19.3.0).
- **csstype 3.1.3 → 3.2.3**: styled-components 6.4 types now come from the same csstype version as React 19's `CSSProperties`.
- **Faster StyleSheet insertion** (constructable stylesheets / batched insertion) — runtime behavior, not API.
- **SSR/StyleSheetManager tweaks** — not used here (no SSR, no custom StyleSheetManager).
- Dependency slimming: `tslib`, `postcss`, `shallowequal`, `@types/stylis`, `@emotion/unitless` dropped from the dependency list (lockfile shrank by ~31 lines).

## Usage audit (webview-ui)

Only `styled.*` element factories — no `StyleSheetManager`, no `createGlobalStyle`, no `keyframes`, no `ThemeProvider`:

- `webview-ui/src/components/common/CodeBlock.tsx` — `CodeBlockButton`, `CodeBlockButtonWrapper`, `CodeBlockContainer`, `StyledPre`
- `webview-ui/src/components/common/MermaidBlock.tsx` — `MermaidBlockContainer`, `LoadingMessage`, `CopyButton`, `SvgContainer` (uses `$isLoading` transient prop — still the correct API in 6.4)
- `webview-ui/src/components/common/MarkdownBlock.tsx` — `StyledMarkdown`

Nothing relies on removed/changed APIs. No deprecation warnings observed in the test suite output.

## Fix made

**`StyledPre` csstype-drift cast removed** (CodeBlock.tsx). The old code bridged `preStyle: React.CSSProperties` (csstype 3.2 via React 19) into styled-components' `CSSObject` (csstype 3.1 in 6.1) with `{ ...preStyle } as CSSObject` plus an explanatory comment. With 6.4.4 both sides resolve csstype 3.2.3, so the cast and the `CSSObject` import were deleted. Verified: `tsc --noEmit` passes without the cast; `pnpm list csstype` shows a single 3.2.3 resolution tree-wide.

## Verification

- `cd webview-ui && npx tsc --noEmit` — exit 0
- `cd webview-ui && npx eslint src/components/common/CodeBlock.tsx` — exit 0
- `cd webview-ui && CI=1 npx vitest run` — **219 files / 2955 tests passed** (full suite)
- `pnpm knip` from the main tree — see PR
- Webview build (`turbo bundle` / VSIX) not rebuilt on this branch; VSIX rebuild owed after merge, as with the React 19.3 upgrade.

## Deferred

- **styled-components 6.5.x** — the current `latest` is 6.5.3. Out of scope per task ("latest 6.4.x"); a later bump would also need its own release-notes pass.
- **VSIX rebuild** — required before any of this is live in the installed extension (same as PR #515).
- **Runtime smoke in the real webview** — styled-components is only used by three display components; the full vitest suite passing in jsdom is the practical coverage, but a manual glance at CodeBlock/Mermaid rendering after the VSIX rebuild wouldn't hurt.
