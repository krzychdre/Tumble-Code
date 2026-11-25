# Cloud web: the task page's Delete asks with the list's dialog

**Status:** done on `fix/web-task-delete-dialog`
**Related plans:** `2026-11-25_12-56_cloud-web-task-list-cards.md` (the dialog), `2026-11-25_13-03_cloud-web-phone-cockpit.md` (Delete inside Details)
**Touched:** `self-hosted-cloudapi/src/web/templates/_delete_dialog.html` (new), `tasks_list.html`, `task_detail.html`,
`src/web/static/app.js`, `tasklist.js`, `live.js`, `src/routers/web_tasks.py`, tests (`app_checks.html`,
`tasklist_checks.html`, `live_checks.html`, `test_browser_js.py`, `test_web_tasks.py`, `test_web_a11y_csp.py`)

## Symptom

After #1369 a row's Delete on the list opened a dialog naming the task, its messages and its subtasks, but the task
page's "Delete task" still asked the browser's plain `confirm()` (`data-confirm`), offered no subtasks and could
delete a running task, which the next message of that task recreates truncated (`realtime/sio.py`, `on_task_event`
get-or-creates the row).

## Fix

- One dialog: its markup moved from `tasks_list.html` into `templates/_delete_dialog.html`, included by the list
  and by the owner's task page; its script moved from `tasklist.js` into `app.js`, which every page loads. Any
  `button[data-delete-dialog]` opens it and fills it from `data-title`, `data-messages`, `data-subtasks`; it posts to
  the button's `formaction` (a list row) or its form's `action` (the task page), with `include_subtasks`.
- Task page: the Delete button carries those attributes (its subtree size is `subtask_count`). It renders disabled,
  with "Stop the task before deleting it" on its form, when the registry has the task live
  (`registry.live_tasks`, as the list does); `live.js` keeps it in step with `taskState()` (running and waiting
  block it; the rendered state stands until the join answers).
- `data-confirm` stays in `app.js`: unshare, dataset, settings and project merge forms still use it.
- Without scripting the button posts on its own, as before.

## Tests

- `app_checks.html`: a button without `formaction` opens the dialog, which posts to its form; names and counts.
- `tasklist_checks.html`: the list's dialog checks now run against `app.js`.
- `live_checks.html`: Delete is blocked while running or waiting, free when idle, done or offline, and the rendered
  state stands before the join.
- `test_web_tasks.py`: the task page's form, its attributes and the dialog, blocked or not by the registry.
- Mutations, each red then restored: no form-action fallback in `app.js` (app_checks), no "connecting" guard in
  `live.js` (live_checks), `delete_blocked=False` in the route (test_web_tasks).
