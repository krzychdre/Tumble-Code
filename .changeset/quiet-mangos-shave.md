---
"tumble-code": patch
---

Re-enable the ESLint rules that were turned off to unblock the 2026-09-24 refactor and fix their findings: `no-useless-escape`, `no-empty`, `prefer-const`, `@typescript-eslint/ban-ts-comment` and `no-case-declarations` (src), `@typescript-eslint/no-require-imports` (src, with a test-file carve-out and documented inline disables for deliberate lazy CJS loads), `no-unassigned-vars` (shared base config), and the stale `react/jsx-key` / `no-case-declarations` per-file overrides in the webview.
