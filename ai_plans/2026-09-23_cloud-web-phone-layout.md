# Cloud web: every page fits a phone

**Status:** done on `feat/cloud-web-phone-layout` (stacked on `feat/cloud-web-task-cost-summary`), committed,
not pushed. Third and last of the stack.
**Related plans:** `2026-09-23_cloud-web-task-cost-summary.md` (the spend table this lays out on a phone),
`2026-07-30_cloud-web-gui-overhaul.md` (the design system).
**Touched:** `self-hosted-cloudapi/src/web/static/app.css`, `src/web/static/render.js`, `src/web/static/live.js`,
`src/web/templates/task_detail.html`, new `tests/test_phone_layout.py`, `tests/browser/render_checks.html`,
`tests/browser/live_checks.html`, `tests/test_browser_js.py`

## Symptom

"On the phone all these pages are completely unreadable."

## What was happening

Measured on a clone of the live DB, Chrome emulating a 390 px phone (DevTools protocol, touch, DPR 2):

| Page     | Laid out at | Widest element                                      |
| -------- | ----------- | --------------------------------------------------- |
| Tasks    | 738 px      | a long task title (`.cell-title`), nowrap           |
| Task     | 489 px      | top bar; subtask grade badges; timeline time stamps |
| Metrics  | 486 px      | top bar ("Sign out" ends at 486)                    |
| Settings | 486 px      | top bar                                             |

A page wider than the screen is not scrolled sideways on a phone: the browser zooms the whole page out to fit.
So one element that would not wrap shrank every page to 53-80% of its size. The common cause is the top bar
(brand, three tabs, sign-out in one fixed-height row, about 486 px). On top of that:

- **Task list:** below 860 px the row grid became `flex-direction: column`, so every figure took its own line
  (eight lines a row), and the title, still `nowrap` in a column that sized to its content, set the page's
  width. The comment above the rule said the figures should "wrap under the title as a run of values"; the
  code did not.
- **Task page:** the subtask rows kept their desktop grid (25rem of fixed tracks); the timeline rows kept the
  full date and time (`toLocaleString()`) beside the model badge and the request's figures; the live controls,
  sticky at the bottom, took about a third of the screen, and when the extension was offline the whole panel
  had `opacity: 0.6`, so the conversation showed through it (on desktop as well).
- **Metrics:** the period switch wrapped inside its buttons ("7 / days"); the roughest-runs reasons were cut
  to "3 corrections fr…".

## Fix

All below 640 px unless noted:

- **Top bar:** wraps, the tabs take a row of their own (full width, equal thirds), and it scrolls away
  (`position: static`) instead of holding two rows of a small screen.
- **Task list (below 860 px):** rows are `flex-wrap` runs: title on its own line (up to 2 lines, clamped),
  then badges and figures flowing after it; empty cells take no gap. The same rule serves the subtask rows
  on the task page. Below 640 px the per-row Delete is hidden (it took a third of the row's width); deleting
  on a phone is a tick plus "Delete selected" in the bulk bar, which now wraps. The tree gutter narrows.
- **Task page:** the title is `--t-lead` and Delete goes under it; the spend table drops its in/out columns
  (tokens and cost carry the account); timeline rows drop the date (`render.js` now emits
  `<span class="msg-day">date, </span>time`, reading exactly as before) and put the row's detail (a
  request's figures, a command, a path) on its own line, so a request's cost is never cut; the time keeps
  one place on every row.
- **Live controls:** the six auto-approval toggles fold behind an "Auto-approve settings" button (phone only;
  `live.js` toggles `.show-auto` and `aria-expanded`). At every width the offline dimming now applies to the
  panel's contents, not the panel, so it is no longer see-through.
- **Metrics:** the period options stay on one line (tighter padding, the control scrolls if ever needed); a
  rough run's reason goes on the line under its title.

## Tests

- **New `tests/test_phone_layout.py`:** the app renders `/app`, `/app?scope=all`, `/app/tasks/run`,
  `/app/metrics`, `/app/settings` over a seeded run with every element that ever overflowed (long title, long
  worktree path, long model id, subtask, request figures, long command, a 400-character code line). Each page,
  with its assets pointed at the static directory, is laid out by headless Chrome inside a 390 px iframe (a
  headless window cannot be narrower than 500 px, and at 500 px the old top bar still fitted). A script in the
  page lists every element reaching past the content edge that no clipping ancestor contains, and posts it to
  the parent frame, which Chrome dumps. A scrolling page loses 15 px to the desktop scrollbar, so it is held
  to 375 px, the narrowest phones. Guards against a vacuous pass: the frame must be 390 px, and the page must
  have drawn its rows / messages / spend table / controls.
- **Verified against the code before this branch** (a detached worktree of the previous branch with only the
  test copied in): all 5 pages fail, naming `nav.mainnav`, `a.btn.ghost` at 486, `span.cell-title` at 737,
  `span.cell-grade` at 489, `span.msg-meta` at 611.
- `render_checks.html`: the split stamp has its date part and reads as `toLocaleString()`. `live_checks.html`:
  the fold opens and closes and reports it (a fourth load of `live.js` on a fresh button).
- Full suite: 233 passed.

Visual check on the DB clone, emulated phone: all four pages at 390 px, nothing past the edge except code
lines inside their own scrolling blocks; desktop (1440) and tablet (768) screenshots unchanged apart from the
opaque control bar and the tablet's list rows now wrapping instead of stacking.

## Notes

- Authentik's own sign-in page is not ours and was not looked at.
- The settings page copy contains em dashes; product copy, untouched here.
