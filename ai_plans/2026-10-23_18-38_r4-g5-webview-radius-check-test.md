# R4 G5: test for scripts/check-webview-radius.mjs

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section G).

## Touched files

- `scripts/__tests__/check-webview-radius.test.mjs` (new)

## Problem

`scripts/check-webview-radius.mjs` runs in `webview-ui`'s lint script and was the only CI-reached script without a
test in `scripts/__tests__`.

## Change

`check-webview-radius.test.mjs` runs the script, as the lint script does, against a throwaway `src/` tree and
checks its decisions:

- accepted: `rounded-control` / `rounded-floating` with side and variant forms, `borderRadius: 0` and the two
  tokens inline, `border-radius` `0` / `unset` / token in `index.css`; skipped: specs, `__tests__/`, comment
  lines, `.d.ts` files, CSS files other than `index.css`;
- reported with `file:line` and exit 1: `rounded`, `rounded-full`, `hover:rounded-md`, `rounded-[3px]`, a numeric
  or foreign-token inline `borderRadius`, a pixel `border-radius` in `index.css`.

The script itself is unchanged.

## Tests

`node --test scripts/__tests__/check-webview-radius.test.mjs`: 2 pass. Mutation checks, each turned a test red:
spec skip disabled, side forms dropped from the allowed pattern, comment skip disabled, CSS rule applied to every
CSS file, `.d.ts` skip removed, `:` dropped from the class prefix set, any `--radius-*` token accepted inline,
`unset` no longer accepted in CSS.
