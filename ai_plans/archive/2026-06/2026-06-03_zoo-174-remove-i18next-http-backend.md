# Zoo-174: Remove unused `i18next-http-backend` dependency

## §0 Context & Credit

Ported from Zoo-Code PR #174, upstream commit `c4ee017f7`.

Original author: Elliott de Launay <edelauna@gmail.com> (the renovate[bot] opener
is a bot trailer; the substantive authorship is Elliott's).

Trailer: `Co-authored-by: Elliott de Launay <edelauna@gmail.com>`

## §1 What & Why

`i18next-http-backend` (^3.0.2) was listed as a `dependencies` entry in
`webview-ui/package.json` but was never used. The webview loads all locale JSON
files at build time via Vite's `import.meta.glob` (`setup.ts`), not over HTTP at
runtime. The i18next initialisation in `setup.ts` only calls `.use(initReactI18next)`
— there is no `.use(HttpBackend)` or any reference to `i18next-http-backend` /
`HttpBackend` / `HttpApi` anywhere under `webview-ui/src`.

Removing it shrinks the install footprint and eliminates a package whose presence
implied incorrect usage expectations.

## §2 Scope

Files changed:

- `webview-ui/package.json` — remove the `"i18next-http-backend": "^3.0.2"` line
  from `dependencies`.
- `pnpm-lock.yaml` — regenerated; i18next-http-backend and its orphaned transitives
  are dropped entirely (count goes 3 → 0).

No source files touched. No other package.json files affected.

## §3 Verification

Pre-removal checks:

1. `grep -rn "i18next-http-backend\|HttpApi\|HttpBackend\|http-backend" webview-ui/src`
   → **no results** (confirmed unused in all source files).

2. `webview-ui/src/i18n/setup.ts` inspected manually: only `initReactI18next` is
   `.use()`'d; locales loaded via `import.meta.glob("./locales/**/*.json", { eager: true })`.
   No HTTP backend registration.

Post-removal checks:

- `grep -c "i18next-http-backend" pnpm-lock.yaml` → **0** (was 3 before removal).
- `pnpm check-types` (root, 13/13 packages) → all successful.

## §4 Acceptance

- [ ] `grep -c "i18next-http-backend" webview-ui/package.json` → 0
- [ ] `grep -c "i18next-http-backend" pnpm-lock.yaml` → 0
- [ ] `pnpm check-types` → 13/13 successful (no regressions)
- [ ] CI green (type-check, lint, unit tests)
