# Rectangular Corners (Remove Rounded Corners) - Implementation Plan

**Date:** 2026-05-22
**Branch:** `feat/ui-rectangular-corners` (stacked from `feat/ui-block-timestamps`)
**Status:** Approved

## 1. Objective

Give all webview buttons and UI elements rectangular (square) corners by
zeroing border radius through a single centralized location instead of editing
the 65+ files that use `rounded-*` utilities.

## 2. Evidence (mechanism verified)

- `webview-ui/src/index.css` defines `--radius: 0.5rem` (line ~179) and derives
  `--radius-lg/md/sm` from it in the `@theme` block (lines ~57-59).
- **Radius is only PARTIALLY centralized.** Verified usage inventory across
  `src/` (`grep rounded`):
    - `rounded`, `rounded-md`, `rounded-lg`, `rounded-sm`, side variants →
      resolve via theme `--radius*` tokens.
    - `rounded-xs` (15x), `rounded-xl` (16x + side variants), `rounded-2xl` (2x)
      → Tailwind v4 DEFAULT tokens (`--radius-xs/xl/2xl` from
      `tailwindcss/theme.css`), NOT overridden by this project.
    - `rounded-full` (31x) → Tailwind v4 STATIC utility
      (`border-radius: calc(infinity * 1px)`), not theme-mapped.
- The shadcn `Button` (`ui/button.tsx`) uses `rounded-full`; `Input` and
  `Textarea` use `rounded-xl`. So changing only `--radius` would leave the
  primary interactive elements rounded. A full scale override is required.

## 3. Tech Strategy

- **Pattern:** Single-location centralized change in `index.css`:
    1. Set `--radius: 0` so all `--radius`-derived tokens collapse.
    2. In the `@theme` block, override the full Tailwind radius scale
       (`--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-lg`,
       `--radius-xl`, `--radius-2xl`, `--radius-3xl`, `--radius-4xl`) to `0`.
    3. Add a focused `@layer utilities` override flattening the static
       `rounded` and `rounded-full` family (incl. side variants) to `0`,
       since those are not theme-mapped.
- **Constraints:** No per-component edits. No new files. Keep the change
  readable and grouped with an explanatory comment.

## 4. File Changes

| Action | File Path                  | Brief Purpose                                                                   |
| :----- | :------------------------- | :------------------------------------------------------------------------------ |
| [MOD]  | `webview-ui/src/index.css` | Zero `--radius`, override radius scale, flatten static `rounded`/`rounded-full` |

## 5. Execution Sequence

1. Set `--radius: 0` in the theme variable block.
2. Add the full `--radius-xs..4xl: 0` overrides in `@theme`.
3. Add `@layer utilities` rule zeroing `.rounded`, `.rounded-full` and their
   directional variants.
4. Typecheck, lint, build.

## 6. Blast Radius

- Purely visual; no logic, no API, no type changes.
- Affects every component using any `rounded-*` utility (intended).
- Genuine circles (avatars, status dots, spinners) become squares — this is
  the explicit user request ("rectangular forms"). Documented as accepted.
- No tests assert on border-radius, so no test regressions expected.

## 7. Verification Standards

- [ ] `pnpm check-types` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm build` succeeds.
- [ ] Visual: buttons, inputs, cards, dialogs render with square corners.
