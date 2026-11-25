# Cloud web task list: cards, live strip, delete from the list

Status: done on `feat/web-task-list-cards`.

Related: the cloud-web ergonomics round of 2026-11-25 (preview in the owner's private_docs), sibling branches
`feat/web-ask-dock`, `feat/web-follow-tail`, `feat/web-phone-cockpit`.

Touched: `src/realtime/hub.py`, `src/realtime/sio.py`, `src/web/presenters/live_tasks.py` (new),
`src/web/presenters/task_rows.py`, `src/web/presenters/task_list.py`, `src/routers/web_tasks.py`,
`src/services/share_service.py`, `src/web/templates/tasks_list.html`, `src/web/templates/_attention.html` (new),
`src/web/static/tasklist.js`, `src/web/static/app.css`, tests.

## Problem

The owner asked for a list where tasks are told apart at a glance, for steering tasks from a phone when away from
the computer, and for deleting a task (its whole conversation) from the list.

- Rows differed only by a zebra background; nothing said which task was running or waiting for an answer.
- Nothing on the list showed live tasks at all, though the bridge registry (`realtime/hub.py`, one process) holds
  every task's last `instanceState` snapshot.
- A row's delete was a transparent icon revealed on hover and hidden entirely on a phone (no hover there).
  It deleted the task alone, so its subtasks stayed behind as runs, and it asked a plain `confirm()`.

## Fix

- **State, one table.** `live_state(snapshot)` (hub.py): waiting when `currentAsk` is one of the interactive asks
  (`followup`, `command`, `tool`, `use_mcp_server`, mirroring `interactiveAsks` in `packages/types`), running when
  `isRunning`, else not live. A row's state is its live state, else `unfinished` by grade, else `done`
  (`live_tasks.rest_state`, `task_rows._list_row`). `app.css` maps each to a colour (`[data-state]`), used by the card edge, the pill and
  the strip.
- **Cards.** Every run in `.task-list` is a card with a 4px state edge; subtasks sit inside on the sunken ground.
  Run titles are a step larger and clamp at two lines (three on a phone). A live row has a "Working" or "Waiting
  for you" pill.
- **Day headings.** On the newest-first list (`sort=updated`, not grouped) the page's rows sit under Today,
  Yesterday or "Fri 29 May" (year added outside the current one), each with the count and cost of the whole day
  under the current filters (one count/sum query per day on the page), so a day cut by the pager is still told
  whole. Sums follow the group rule: run cost under Runs, own cost under All.
- **Needs your attention.** `attention_items` builds a card per live task of the reader with a row (waiting first,
  newest first): the question, the command, the tool or MCP call it waits on, or mode, model and cost while it
  runs; Answer, Review or Open. Rendered with the list and alone at `GET /app/attention` (`_attention.html`).
- **Pushed, not polled.** A browser socket joins `user:<id>` at its handshake. The registry's `note_task_event`
  reports whether what the strip shows changed (state, the ask's ts, the mode; token counts change on every
  request and are left out), and `sio.py` then emits `user:tasks_changed` to that user's room. A window going
  away (disconnect, unregister) emits it too, since its tasks stop being live. The list page loads socket.io for
  this only; `tasklist.js` fetches `/app/attention` on the event (and on a reconnect), replaces the strip, and
  brings the rows in line (state, pill, delete enabled or not).
- **Delete from the list.** The trash button is always visible (40px on a phone; subtask rows on a phone keep
  using select mode). It opens a `<dialog>` naming the task, its message count, that the conversation and share
  link leave the cloud for good while the VS Code history keeps its copy, and "Also delete its N subtasks"
  (ticked) when it has any. `POST /app/tasks/{id}/delete` takes `include_subtasks=1` through `delete_tasks`;
  `delete_shared_task` had no other caller and is gone. Without scripting the row's button still posts on its
  own. A live task's delete is disabled ("Stop the task before deleting it"): `on_task_event` get-or-creates the
  row on the task's next message, so deleting it mid-run would bring back a truncated half.

## Failure surface

| Scenario                             | Before                      | After                                              |
| ------------------------------------ | --------------------------- | -------------------------------------------------- |
| Task waits for an answer             | invisible on the list       | strip card with the question, row pill, amber edge |
| Task finishes while the list is open | n/a                         | strip and row update on the bridge event           |
| Token usage update                   | n/a                         | no browser traffic (not part of the live key)      |
| Delete on a phone                    | only via select mode        | trash on every run card, dialog                    |
| Delete a run with subtasks           | subtasks left as runs       | dialog offers the subtree, ticked                  |
| Delete a running task                | allowed, row came back half | disabled until stopped                             |

## Tests

- `test_bridge.py`: `live_state` table; the live key ignores token counts and reacts to state, ask and mode;
  `live_tasks` per user and dropped on detach; the browser joins its user room at connect; only strip changes
  reach the user's room, never another user's; a window going away tells its user, a browser leaving does not.
- `test_web_task_list.py`: strip order and summaries (HTML escaped), unsaved and foreign tasks left out, the list
  carrying the same strip and the socket config; the empty placeholder; row state, pill, disabled delete and the
  dialog's data; day headings with whole-day figures across pages, under Runs and All; no headings when grouped
  or sorted by cost.
- `test_web_tasks.py`: a row's delete with and without its subtree.
- `test_web_presenters.py`: row state from live state, then grade.
- `tests/browser/tasklist_checks.html`: the dialog (action, texts, option hidden and unticked without subtasks,
  posts `include_subtasks`), the live strip (fetch on the event and on reconnect, rows following it, a sign-in
  answer kept out).
- Mutation-checked: ask precedence in `live_state`, the mode in the live key, the user room join, the
  `include_subtasks` read, the day range in the day sums, the disabled toggle in `syncRows`.

## Notes

- Idle asks (`completion_result`, `api_req_failed`, `mistake_limit_reached`, ...) do not put a task on the strip;
  only the interactive ones do, as the extension's `TaskStatus.Interactive` does.
- Rows not on the current page are not touched; a reload of the list (filter swap) re-renders them from the
  registry anyway.
- After a delete the list opens on the remembered view (the view cookie), as after a bulk delete.
