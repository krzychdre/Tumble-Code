# Cloud web: text sliding out of its box

Date: 2026-10-02. Branch: `fix/cloud-web-text-overflow`.
Scope: `self-hosted-cloudapi/src/web/static/app.css` and `tests/test_phone_layout.py`. The Diagnostics page
(`diagnostics.html`, `.diag-*` rules) is out of scope: another branch rewrites it.

## Request

The owner (translated): "Clean up the CSS, I see problems with text sliding out."

## Method

1. A scratch pytest module (not committed) seeded an in-memory database with deliberately hostile data and rendered every
   page through the test client: an unbroken 130-character prompt as the title, model ids such as
   `accounts/fireworks/models/qwen3-coder-480b-a35b-instruct`, a 150-character path without a break, a long command line, a
   wide Markdown table, wide JSON, a tool with a 40-character name, an unknown message kind, error messages with long URLs,
   a three-level subtask chain, four-figure dollar costs, a 57-character account name, filter chips with long values, and the
   sign-in error, forbidden, not-found and signed-out pages.
2. Each page was laid out by headless Chrome at 1280px, at 900px, and at 390px (a phone, inside a 390px iframe because
   headless Chrome will not make a window narrower than 500px), with every `<details>` opened. A script in the page listed
   (a) elements reaching past the screen edge and (b) every text node whose right edge runs past the box it sits in, up to
   the first box that clips it; a clip that is neither a scroll box nor an ellipsis counts as text cut off without a sign.
3. Full-page screenshots before and after: `/tmp/css-overflow-shots/before/` and `/tmp/css-overflow-shots/after/`
   (`*-1280.png`, `*-390.png`, `report.txt`).

## Defects found and fixed

| Page | Element | What happened | Cause | Fix |
| --- | --- | --- | --- | --- |
| Task detail, shared view (phone) | `h1.page-title` | An unbroken title made the page 563px wide on a 390px phone (659px on a subtask page) | Nothing allowed a break inside a word | `.page-title { overflow-wrap: anywhere; min-width: 0 }` |
| Task detail (desktop, subtask page) | Delete task button | Pushed out of the title row, over the timeline column | The h1 is a flex item with `min-width: auto`, so it never shrank | `.detail-title-row .page-title { flex: 1 1 auto }`, `.task-delete-detail { flex-shrink: 0 }` |
| Task detail, shared view (phone) | `.detail-models .badge-model` | Long model ids cut off at the screen edge with no ellipsis | Badge is `nowrap; overflow: hidden` and the name is a bare text node there | In the detail header the badge wraps: `inline-block; white-space: normal; overflow-wrap: anywhere` (the full id is the fact stated there); the list keeps its truncating badge |
| Task detail (phone) | `span.msg-role` | A long tool name (or an unknown message kind) reached 465px on a 390px screen | `flex-shrink: 0` with no cap | `max-width: 100%; overflow-wrap: anywhere` (still does not shrink on desktop, where the detail yields first) |
| Task detail | Command block | The end of the command (pipe, target) hidden behind a sideways scroll | `pre` scrolls horizontally | `.msg.role-command .msg-body pre { white-space: pre-wrap; overflow-wrap: anywhere }`; output, diffs and JSON keep scrolling in their capped box |
| Task detail | Markdown table in a message | Every header and cell broken mid-word ("column_0_wit / h_a_long_hea / der") | `.msg-body { overflow-wrap: anywhere }` applied to table cells squeezed into the column | `.msg-body table { display: block; overflow-x: auto; overflow-wrap: normal }`: words stay whole, the table scrolls in its own box |
| Task list (desktop) | Cost cell | "Σ $15345.6589" ran 10px into the grade column | Cost track 5rem | Task list cost track 6rem; subtask panel cost track 6rem |
| Task list (900px) | Header "Task · project · model" | Spilled 13px into the Messages column after the cost track widened | `nowrap` label in a `minmax(0, 1fr)` track | `.head-title { min-width: 0; overflow: hidden; text-overflow: ellipsis }` |
| Every page (861px to about 1150px) | Top bar | A long account name pushed Sign out to 1154px on a 900px screen | `.user` and `.user-name` `nowrap` with no way to shrink | `.topbar-end`, `.user`: `min-width: 0`; `.user-name`: ellipsis, `max-width: 20rem` (full name stays in the `.user` tooltip); `.user-mark` keeps its size |
| Task list, empty filtered state (phone) | `.filter-chip` | "Search:" squeezed to one letter per line beside a long value | The chip was `inline-flex`, so the label text and `<b>` value were flex items fighting for width | `display: inline-block; text-align: left`; the value wraps as text |
| Sign-in error, forbidden (phone) | `.empty-lead`, `.empty-hint`, `h1` | A long reason, a URL or an IPv6 address pushed the page to 687px / 593px | No break opportunity | `.empty { overflow-wrap: anywhere }` |
| Metrics | Daily table | "498,775,624$4938.2600": tokens and cost ran into each other | Fixed 5rem / 5.5rem columns (sized for the abbreviated figures of the breakdown cards) with full integers | `.chart-table table.breakdown` columns 2 and 3: `width: 7rem` |
| Metrics (900px) | `.stat-value` | "$14814.7400" ran 12px past a 190px tile | Fixed stat font size | `.stat-card { container-type: inline-size; min-width: 0 }`, `.stat-value { font-size: min(var(--t-stat), 12cqi); overflow-wrap: anywhere }` |
| Task detail (phone) | Nested subtask row | "↳" alone on a line above the title | The arrow was followed by a normal space | `content: "↳\00a0"` (no-break space) |

Not defects (reported by the probe, left as they are):

- `.head-sort.sorted` arrow hangs about 9px past its label: deliberate (`margin-right: -1em`, so the label stays flush).
- The timeline column sits outside `main.content.read` at 1240px and up: deliberate positioning.
- Output, diff, JSON and code blocks wider than the column: they scroll inside their own capped box (`max-height: 26rem;
  overflow: auto`), which is the intended behaviour for machine output.

## Rules chosen

- Prose and titles that may carry identifiers break anywhere (`overflow-wrap: anywhere`) instead of widening the page.
- One-line labels in fixed tracks (list title, header label, account name, list badges) keep `nowrap` and truncate with an
  ellipsis, with the full value in a `title` tooltip (the list row, the badges and the account name already carry
  one; the header label is static text).
- Flex and grid children that hold text get `min-width: 0` so they can shrink.
- Machine output scrolls in its own capped box; a command line, whose tail matters, wraps.
- Tables that cannot fit scroll in their own box instead of breaking words.
- Figure columns are sized for realistic worst cases rather than truncated: a truncated number is a wrong number.

## Tests

`tests/test_phone_layout.py`:

- `test_long_text_stays_inside_its_box`: six pages (all-tasks list, empty filtered list with long chips, run detail,
  nested subtask detail, metrics, shared view) at 390px and 900px with the hostile data; asserts nothing reaches past the
  screen and no text runs past its box (or is cut without a sign). On the old stylesheet 10 of the 12 cases fail.
- `test_overflow_rule_is_in_the_stylesheet`: browser-free pins for the 12 rules the fixes depend on, so a later edit that
  drops one fails with its name even where Chrome is absent.
- The measuring harness `_lay_out_on_a_phone` now takes a width and also reports text spill; the existing
  `test_every_page_fits_a_phone` is unchanged in what it asserts.
