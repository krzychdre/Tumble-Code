# Bridge replays live tasks on connect

**Status:** done on `fix/bridge-replay-on-connect`
**Related plans:** `2026-11-25_14-26_cloud-web-task-titles.md` (found the defect), `2026-11-25_12-56_cloud-web-task-list-cards.md`
**Touched:** `packages/cloud/src/bridge/BridgeOrchestrator.ts`, `src/extension/bridge.ts`, `src/core/webview/panelRegistry.ts`,
`src/core/webview/ClineProvider.ts`, `src/core/webview/TaskSlot.ts`, their specs, `packages/cloud/src/__tests__/outboundRedaction.spec.ts`

## Symptom

A task started before the bridge socket connected had no opening prompt in the cloud: the web list named it
"Untitled task" and its conversation began at a later message until the task was shared (sharing backfills the
whole history). `tumble -p` always starts its task first. Live proof against the running cloud, same fake model,
same prompt:

| client                        | stored title                                   | earliest stored message | rows |
| ----------------------------- | ---------------------------------------------- | ----------------------- | ---- |
| installed `tumble` (old code) | `None`                                         | `say: api_req_started`  | 6    |
| this branch's CLI             | `'Replay check: ask me which color I prefer.'` | `say: text`, the prompt | 7    |

## What was happening

- `src/extension.ts` sets up the bridge only after the cloud start settles, and `BridgeOrchestrator.start()`
  subscribes to the task bus only then; `emitTaskEvent` used `this.socket?.emit`. Every task event before that
  never reached the server.
- After a dead connection is detected, socket.io-client buffers emits made while disconnected, but packets written
  into a half-open socket before the ping timeout notices are lost too.

## Fix

On every `connect` (first and each reconnect) the orchestrator replays `options.liveTasks()`: each task's messages
in order, as the same `message` events the bus produces (same `workspacePath` stamp, same `redactSecrets`), then one
`instanceState` per task, so the web shows it running or waiting at once.

- **Why the socket and not `TelemetryClient.backfillMessages`:** the server stores a bridge message with
  `upsert_task_message` (`self-hosted-cloudapi/src/services/telemetry_service.py`), an `INSERT ... ON CONFLICT
(task_id, message_ts) DO UPDATE` that only lets a message grow (a final always wins, a partial only when at least
  as long). Replaying a message the server already has is therefore a no-op, whatever live events arrive meanwhile.
  The backfill endpoint replaces the task's stored rows, which would race with live events.
- **The title rule holds:** a `text` say counts as the prompt only when no message with a smaller `ts` is stored
  (`_has_earlier_message`), so the replayed prompt still names the task even when later events reached the server
  first.
- **One message at a time, each waiting for its ack (10 s):** `_user_session` in `realtime/sio.py` lets one account
  hold 8 database sessions and queue 64 events; past that, events are dropped. A long history sent at once would
  cross it. A replay stops when its connection drops or a newer connect starts another one.
- **Live tasks:** `panelRegistry.liveTasks()` gathers `ClineProvider.ownLiveTasks()` of every panel not being
  disposed: the slot's tasks (`TaskSlot.liveTasks()`: foreground and detached, at rest or working, so a quick `-p`
  task that already completed is included) plus the live parallel subagents. `getRunningTasks` now iterates the same
  list. `bridge.ts` maps it to `{ taskId, messages }`, so `packages/cloud` stays free of `src` imports.

## Tests

- `BridgeOrchestrator.test.ts`: order (messages then state, per task), redaction of a replayed message, one message
  per ack, a dropped connection stops the replay and a reconnect replays again, nothing sent with no live task. The
  inline constructions there now go through `build(opts)`.
- `bridge.spec.ts`: `liveTasks` maps the open panels' tasks and skips a disposing panel.
- `ClineProvider.task-slot.spec.ts`: `TaskSlot.liveTasks` holds the foreground task at rest and the detached one.
- Mutations, each red then restored: no replay call on connect (4 failed), no "connection still current" guard
  (1 failed), no disposed-panel filter (1 failed).
- End to end against the live cloud with a fake OpenAI-compatible model (no epyc load); table above.

## Caveats

- Every connect replays the whole history of every task the window holds. The server writes each message again
  (same content); for a self-hosted account this is a few seconds of sequential upserts after a server restart.
- A `tumble -p` task that finishes and exits before the socket ever connects is still lost; the process does not
  wait for the bridge.
- A single message larger than the engine.io frame limit is as unsendable on replay as it was live.
