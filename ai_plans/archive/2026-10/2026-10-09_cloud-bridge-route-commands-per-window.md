# Web Stop reaches the wrong VS Code window: investigation & fix

**Status:** fixed on `fix/cloud-bridge-route-commands-per-window`
**Related plans:** `2026-10-09_bridge-misses-editor-tab-tasks.md`, `2026-10-09_bridge-commands-target-task-by-id.md` (extension half)
**Touched:**

- `self-hosted-cloudapi/src/realtime/hub.py` (`ConnectionRegistry`)
- `self-hosted-cloudapi/src/realtime/sio.py` (event/command/join handlers)
- `self-hosted-cloudapi/src/web/static/live.js` (comment only)
- `self-hosted-cloudapi/tests/test_bridge*.py`

## Symptom

The owner runs tasks in parallel: in the sidebar, in editor tabs, as parallel subagents,
and in more than one VS Code window (on 2026-10-09 two windows were connected to the
bridge). Stop on the web must stop the task it was pressed for.

## What was happening

`ConnectionRegistry` kept one extension socket per user, "newest registered wins", and
`on_task_command` relayed every command to it. With two windows, a Stop for a task run in
the older window went to the newer one, which does not have the task. Two more effects of
the same single-slot design:

- When the newest window closed, the older one stayed connected but the user showed as
  "Extension offline" (the slot was cleared, nothing took its place).
- `instanceState` snapshots of every task were merged into one per-user dict, so the
  join answer described whichever task reported last (the web filtered it by `taskId`).

## Fix

- Every extension socket of a user is tracked, oldest first.
- `note_task_event(sid, task_id, data)`, called only after the ownership check, records
  which socket streams the task and keeps the task's own last snapshot.
- `extension_sid(user, task_id)` returns the socket that streams the task, else the newest
  (resuming a task no window runs).
- `instance(user, task_id)` is the registration of that window merged with the task's own
  snapshot; `task:join` and the workspace-path fallback use it.
- Detaching a window forgets its tasks and their snapshots (a stale `isRunning` must not
  outlive the window); the user stays online while another window is connected.
- `reset()` replaces the tests' clearing of private tables.

A snapshot of a task with no row yet is no longer stored (before, it merged into the
user's record): it can only be stored once ownership is known.

## Tests

Registry: routing by streaming window, per-task snapshot isolation, detach of one of two
windows. Handler: Stop for a task streamed by the older of two windows is relayed to it.
Full suite: 1319 passed.

## Caveats

The extension side must address the task by id too (it used to stop the sidebar's
current task whatever the command named); see the related plan. The api image must be
rebuilt.
