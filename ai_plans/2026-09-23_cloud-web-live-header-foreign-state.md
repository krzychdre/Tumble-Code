# Cloud web: the live header showed dashes, or another task's figures

**Status:** done on `fix/cloud-web-live-header-foreign-state` (off `main` `d7237f29d`), committed, not pushed.
First of three stacked branches; `feat/cloud-web-task-cost-summary` and `feat/cloud-web-phone-layout` sit on it.
**Related plans:** `2026-09-23_cloud-web-run-cost-rollup.md` (the run totals the next branch moves to the top).
**Touched:** `self-hosted-cloudapi/src/web/static/live.js`, new `tests/browser/live_checks.html`,
`tests/test_browser_js.py`

## Symptom

The owner's page of a finished task (the ADO analysis run) read:

```
LIVE   mode -   in - / out -   context -   cost $0.1656
```

Tokens, context and mode were dashes; only the cost had a value.

## What was happening

1. At load, `live.js` fills the header from the saved conversation (`applyMetrics`, render.js `getMetrics`):
   in 297.8k, out 5.9k, context 32.2k, cost $0.1656.
2. The socket joins the task room. `on_task_join` (`src/realtime/sio.py`) acknowledges with
   `registry.instance(user_id)`: ONE record per extension, not per task. It is the registration payload
   (`BridgeOrchestrator.register`: `userId`, `workspacePath`, `lastHeartbeat`, no figures, no mode) merged
   (`update_instance_state`) with the last `instanceState` snapshot of whichever task the extension last
   reported on.
3. `live.js` applied that record as if it were this task's snapshot. `applyInstanceState` wrote
   `fmt(tu.totalTokensIn)` unconditionally, and `fmt(undefined)` is a dash; context likewise. The cost alone
   had a `!= null` guard, which is why it survived.

So a registration-only record produced exactly the screenshot. When the extension had since reported on a
different task, the same path showed THAT task's tokens, cost, context, mode, running state (a live Stop
button) and pending ask on this task's page.

## Fix

- `ownSnapshot(inst)`: the join record is applied in full only when `inst.taskId` is this task. Otherwise only
  `autoApproval` is kept: those settings belong to the extension, not the task, and `pushAutoApproval` sends
  every toggle at once, so the controls must start from the extension's real values.
- `applyInstanceState` writes a figure only when the snapshot carries it. A snapshot without token data says
  nothing about tokens; it does not zero them.

## Failure surface

| Join record                      | Before                                   | After                                      |
| -------------------------------- | ---------------------------------------- | ------------------------------------------ |
| Registration only                | in/out/context blanked, cost kept        | conversation's figures kept                |
| Another task's snapshot          | that task's figures, mode, Stop, its ask | this task's figures; auto-approval applied |
| This task's snapshot             | applied                                  | applied (unchanged)                        |
| Relayed snapshot without figures | in/out/context blanked                   | kept, mode still updated                   |

## Tests

`tests/browser/live_checks.html` (21 checks, driven by `test_browser_js.py`): loads the real `live.js` three
times against a stubbed socket.io and conversation, one scenario per join record above. Before the fix 12
checks failed, reproducing the screenshot. Verified by mutation on a scratch copy: restoring
`applyInstanceState(res.instance)` fails 9 checks; dropping the guard on tokens in fails 2.

## Notes

- **Not fixed here, extension side:** `snapshot(taskId)` in `src/extension/bridge.ts` ignores its argument and
  reads `provider.getCurrentTask()`. An event from a task that is not the foreground one (a parent waiting on a
  running subtask) is therefore labelled with its own id but carries the foreground task's tokens, mode and
  running state. The relayed events of that label reach this page. Needs its own branch and a VSIX rebuild.
- The server still returns the whole record on join; filtering there would lose the auto-approval values.
