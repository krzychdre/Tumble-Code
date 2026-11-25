# Cloud web: a task page you can steer from a phone

**Status:** implemented on `feat/web-phone-cockpit`
**Related plans:** `2026-11-25_12-52_cloud-web-ask-dock.md`, `2026-11-25_12-49_cloud-web-follow-tail.md`; preview in the
owner's `private_docs/cloud-web-ergonomics/preview/`
**Touched:** `self-hosted-cloudapi/src/web/templates/task_detail.html`, `src/web/static/live.js`,
`src/web/static/app.css`, `tests/browser/live_checks.html`, `tests/test_browser_js.py`, `tests/test_web_tasks.py`

## Symptom

On a phone the owner's task page spent its first screen on the site's top bar, the workspace, the models, the spend
table and the quality panel before any of the conversation. Whether the task was working, waiting for an answer or
finished was only readable from the conversation itself, and Stop sat in the control bar at the very end of the page.
The control bar floated a little above the bottom edge with small buttons and a 13px text box, which iOS zooms into on
focus.

## Change

- **One state word in the header.** `live.js` keeps a pill next to the back link: Connecting, Offline, Waiting for
  you, Working, Done, Idle (`STATE_LABELS`, `taskState()`). A pending ask the dock shows outranks running, because the
  extension reports a task blocked on an ask as running too; Done is a `completion_result` or
  `resume_completed_task` ask. The pill is the task list's `.state-pill` and takes its hue from the same
  `[data-state]` table, which gains rows for connecting, idle and offline.
- **Header split from the facts.** `task_detail.html` now has the header (way back, state, Stop, title, the Details
  button) and after it `#detail-more`: the workspace, client, recall, share, models and side calls (`.detail-facts`),
  the spend panel and the quality panel. Desktop shows both as before; the Details button and the header Stop are
  phone-only.
- **Phone cockpit (640px and below, live pages only, `.cockpit`).** The site top bar is hidden, the header sticks to
  the top on a compact line with Stop (the same `stop_task` command as the composer's), the title ellipsized on one
  line, and a Details button whose summary repeats mode, tokens, cost and the subtask count. `live.js` keeps the
  summary's mode and figures in step with the spend table's top row. Details folds `#detail-more` and the task's
  Delete button. The control bar docks to the bottom edge full width, with a 16px text box (a new type token,
  `--t-field`, since every size comes from the scale) and 44px Send, Stop and Resume in one row.
- The fold uses the same pattern as the auto-approval fold: a button toggles a class on its host. Both now share one
  `fold(button, host, cls)` helper.
- The read-only shared page keeps today's layout: no cockpit class, no Details button, nothing folds.

## Tests

- `live_checks.html` (59 -> 71 checks): Idle on a registration-only join, Working and the header Stop on this task's
  running snapshot, the header Stop sends `stop_task`, the Details summary follows the run row and the mode, the
  Details fold opens and closes, a pending question outranks running, back to Working after answering, Done on a
  finished snapshot, Offline after a disconnect.
- `test_web_tasks.py`: the owner page renders the cockpit and folds the spend panel inside `#detail-more`; the
  anonymous shared page renders no cockpit.
- Mutations: removing the waiting-outranks-running line turned "a pending question outranks running in the header"
  red; removing the header Stop's `hidden` update turned "this task running: the header offers Stop" red. Both
  restored.
- `test_phone_layout.py` caught the ellipsized title growing to its content width inside the column title row
  (`max-width: 100%` now); `test_web_task_timeline.py` reads the first `.live-controls::after` rule, so the phone
  block does not override it (with the bar at `bottom: 0` the strip sits below the screen anyway).
- Full cloudapi suite after rebasing on #1369: 1726 passed.
- Real page: an owner page rendered by the app (30 exchanges, stubbed socket) in headless Chrome at 390x844 and
  1440x1000, running, waiting on a question, waiting on a command, idle with Details open, and scrolled up with a new
  row: the header sticks, the follow pill sits above the docked bar, the dock fits above the composer.

## Notes

- A `command_output` ask (the dock's "Continue While Running") keeps the header at Working: the command and the
  task run on, so the button is optional (`waits: false` in `ASK_DOCK`). The task list's strip
  (`hub.WAITING_ASKS`) counts it as running too.

- The page title still shows the raw Markdown of the first message (`**one**`); that comes from the title derivation,
  not from this change.
