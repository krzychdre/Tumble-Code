# Cloud web panel: visual polish (one button family, cards, tables, empty states, status colours)

Status: done (PR 2 of 2 for item D8 of `ai_plans/2026-10-01_simplification-round-2.md`; stacked on
`chore/cloud-web-css-dedupe`, which moves the sign-in pages onto `base.html` and the palette onto
`light-dark()`).

Direction from the owner: polish the current style (dark, technical, mono accents, consistent with the VS Code
extension), no redesign; light theme everywhere; the phone layout must not regress. Information architecture
and every figure shown are unchanged.

## Touched files

- `self-hosted-cloudapi/src/web/static/app.css`
- `self-hosted-cloudapi/src/web/static/render.js` (one class string)
- templates: `base.html`, `tasks_list.html`, `task_detail.html`, `settings.html`, `metrics.html`,
  `not_found.html`
- tests: `test_web_a11y_csp.py` (copy button class), `test_web_light_theme.py` (AA check covers the new
  status colour)

## Problem (evidence from before-screenshots and app.css)

- The same small mono bordered button was defined three times (`.theme-toggle` ~367, `.btn-delete` ~1257,
  `.pager-btn` ~1299) plus local size overrides (`.copy-btn`, `.tl-jumps .btn`, `.pager-jump .btn`,
  `.btn-fold`); some were square, some rounded, the fold buttons were bold uppercase.
- Card padding varied per card (`s3 s4`, `s3 s4 s4`, `s2 s4 s3`, `s4`), stacked sections were `s4` or `s5`
  apart, grid gaps `s3`.
- Settings had no space between the page title and its first panel; the metrics header had `s5`, the list
  header `s3`.
- Empty states differed per page: a bare centred paragraph (metrics), a grey `h1` (not found), a panel (no
  tasks yet).
- `input:focus { outline: none }` also matched checkboxes, so a keyboard user saw no focus on any checkbox.
- A running row and the "what the task is doing" line used the amber signal, the same colour as a pending
  approval; the extension shows running in blue and waiting in yellow.
- Filter chips and the Filters toggle were square while every other control is rounded.

## Fix

- `.btn.small` (mono, micro, 26px): with `.ghost` it is the theme toggle, Sign out, row/detail Delete, pager
  Newer/Older/Go, Copy, timeline jumps and Expand/Collapse all. The old per-class rules are gone;
  `.btn-delete` keeps only its "hidden until the row is engaged" behaviour.
- One card rule: `.panel` and the card classes get `padding: var(--s4)` (`--s3` on a phone), stacked
  sections and grid gaps are `--s4` (`--s3` on a phone).
- `.page-head` (shared with `.list-head`, `.metrics-head`): title row, `--s4` above the first panel; Settings
  uses it.
- One empty state: dashed outline card, title, lead, hint (max 60ch) and an `.empty-actions` row; used by not
  found, forbidden, metrics without data, filtered list with no match, the sign-in pages and the
  conversation's own empty/error text.
- Status colours as in the extension: new `--status-run` (link blue, AA in both themes) for the running row,
  its spinner and the live activity line; waiting stays amber (pending approval), done green, failed red.
  Grade, live connection and approval outcome pills share one shape.
- Tables: header over a stronger rule, row hover in the breakdown tables, the spend table got the same header
  rule.
- Focus: checkboxes keep the global focus ring; text fields get a soft ring on `:focus-visible`; row links
  draw the ring inside the row.
- Smaller items: rounded skeleton rows, rounded filter chips and Filters toggle, prose hints capped at 80ch,
  timeline jump labels wrap inside the 7.5rem rail instead of running past it.

## Before / after (screenshots in /tmp/cloud-ui-shots/{before,after}/png, not in the repo)

- Task list: header buttons quieter and matching; otherwise unchanged.
- Task detail: Delete, timeline jumps, Expand/Collapse all in the small mono style; cards evenly padded;
  spend table header rule; a running row is blue.
- Metrics: even card padding and gaps; empty period is a dashed empty card.
- Settings: space under the title, prose hints at a readable width.
- Not found / forbidden / sign-in pages: dashed empty card with a dark title.
- Phone (390px): no overflow (test_phone_layout passes), cards use the tighter padding.

## Tests

- Gates: `pytest tests/test_web_*.py test_phone_layout test_browser_js test_route_boilerplate
test_browser_auth test_sign_in_flow test_auth*.py test_json_islands test_remote_access test_csrf
test_shared_access`: 480 passed (phone layout and browser JS ran, not skipped). `pnpm knip` exit 0.
- No new test: the change is visual; the existing AA test now also covers `--status-run` in both themes.

## Notes / caveats

- The running blue (`#58a6ff` dark, `#0b62c4` light) is a new colour, not a reuse of `--d-in`/`--d-you`, so
  the data-hue encoding stays one meaning per hue.
- Live states (running row, live activity) were checked on a static sheet built from the real stylesheet, not
  on a live bridge.
