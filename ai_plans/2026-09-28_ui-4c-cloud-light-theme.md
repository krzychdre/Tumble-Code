# UI-4c: cloud web panel light theme and theme toggle

Plan: `ai_plans/2026-09-27_ui-modernization.md`, section 3.1 (step 4 of section 5).
Branch: `feat/ui-4c-cloud-light-theme`, stacked on `feat/ui-4b-cloud-a11y`. Everything is in
`self-hosted-cloudapi/`.

## What

- **Light tokens** in `static/app.css`, redefining only `:root` custom properties, written
  twice with identical bodies (a media query and an attribute selector cannot share a
  rule): `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) }` and
  `:root[data-theme="light"]`. Near-white surfaces, `--line` as low-alpha black, the
  accent `#9a5b00`, data hues around 45% lightness, white ink on filled buttons.
  `color-scheme: dark` on the dark `:root`, `light` in the light blocks, so scrollbars
  and date pickers follow.
- **No colour outside the token blocks**: the top bar is
  `color-mix(in srgb, var(--bg) 85%, transparent)`; the hue-tinted borders and the running
  tick's halo are `color-mix` of their token; the danger and approve buttons use new
  `--d-error-ink/-bright` and `--d-cache-ink/-bright`; the floating bar's shadow is
  `--shadow-lift`; ten categorical `--cat-N` hues replace the chart palette literal.
- `<meta name="color-scheme" content="dark light">` in `base.html`.
- **Toggle**: `static/theme.js`, loaded blocking in `<head>` before the stylesheet, puts
  the stored choice (`localStorage["tumble.theme"]`: dark or light; absent is auto) on
  `<html data-theme>` before the first paint. Once parsed it reveals the top bar button
  (hidden without scripting, where the OS preference still applies), which cycles auto,
  dark, light, says the current choice and the next one in its label, and fires
  `tumble:theme` on `window`.
- **Charts**: `metrics.js` reads every colour with `getComputedStyle` from the tokens, and
  destroys and redraws its charts on a `prefers-color-scheme` change and on `tumble:theme`.

## Contrast (WCAG, computed by the tests from the tokens)

Light, on `--bg` / `--surface-1`: text 15.0 / 16.2, dim 7.5 / 8.1, faint 5.3 / 5.7, accent
5.0 / 5.4, data hues 5.0 to 6.3. White on the accent, error and cache fills: 5.4, 5.9, 5.6.
Dark is unchanged apart from 4b's `--text-faint`, and is checked by the same test.

## Deviations

- Beyond the plan's list, the other colour literals (button inks, tinted borders, the
  shadow, the running halo) had to become tokens or `color-mix`, or the light theme
  would have kept dark-theme pieces; a test now forbids literals outside the token blocks.
- The toggle is one cycling button rather than a three-way segmented control, to fit the
  phone top bar.
- 5d replaces Chart.js with server-rendered SVG, so the redraw logic in `metrics.js` is
  short-lived; it is implemented and tested anyway so this branch stands on its own.

## Tests

- `tests/test_web_light_theme.py` (7): both light blocks equal and complete, the accent,
  AA for text, accent and data hues on page and panels in both themes plus button inks,
  no colour literal outside the tokens, metrics.js free of literals and listening to
  `matchMedia`, the meta tag, the head script before the stylesheet, the hidden toggle.
- Browser: `theme_checks.html` (8: stored theme applied while still in `<head>`, toggle
  revealed and labelled, the auto/dark/light cycle and storage, one event per change);
  `metrics_theme_checks.html` (8, stubbed Chart.js: colours from the variables, destroy
  and redraw in the new theme's colours).
- Screenshots of the list, metrics and task pages with a light OS preference looked right.
