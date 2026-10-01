# CLI: uniform spinner glyph width + droplet animation

**Date:** 2026-08-07
**Branch:** `fix/16-cli-spinner-droplet` (stacked on `fix/15-cli-console-error-noise`)
**Status:** implemented

## Problem

1. The gap between the spinner glyph and the verb ("Calibrating…") jitters
   between frames — some frames sit one column further from the text.
2. User wants the star glyphs replaced with a "droplet falling into a
   puddle" animation.

## Root cause (1)

`SPINNER_FRAMES` mixed Unicode width classes: `✳` (U+2733) is East-Asian
Wide since Unicode 9 (`string-width` → 2), while `· ✢ ∗ ✻ ✽` are narrow
(→ 1). Ink lays text out by `string-width`, so it reserved two columns for
the `✳` frame and one for the others; GNOME/VTE renders them all as one
column → the verb visibly jumps. Confirmed in the user's `script(1)` capture:
the `✳` frame bytes carry two spaces before the verb, the `✢` frame one.

## Fix

- `figures.ts`: `SPINNER_FRAMES = ["˙", "·", ".", "∘", "○", "◦"]` — a drop
  falls (˙ · .), hits (∘), the ripple grows (○) and fades (◦). All frames
  verified `string-width === 1`.
- `Spinner.tsx`: forward cycle instead of ping-pong — the droplet animation
  is directional (a reversed fall looks wrong).
- Regression test (`figures.test.ts`): every frame must be exactly one
  column wide by `string-width` (added as a devDependency — it is the same
  metric ink uses for layout).

## Verification

- `pnpm check-types`, `pnpm lint`, `pnpm test` in `apps/cli`.
- Manual: run a prompt, watch the spinner — constant gap, droplet loop.
