# Fix: live task attributed to the wrong worktree in the cloud web view

Date: 2026-06-22
Branch: fix/share-always-backfill-full-task (stacked on the share/backfill work)

## Symptom

Ran a task in the `lids-uniform-api` window; the cloud web view labelled its
worktree as `septicoBackend` (a different project that was also open).

## Root cause (proven, not assumed)

1. The web "worktree" badge is just the last path segment of
   `task.workspace_path` — `_workspace_label()` in
   `self-hosted-cloudapi/src/routers/web.py:90`.

2. `task.workspace_path` is stamped **once and never overwritten** —
   `_stamp_workspace_path()` in
   `self-hosted-cloudapi/src/services/telemetry_service.py:9-21`. First non-empty
   value wins (a task "never moves workspaces").

3. The bridge is default-ON, so for a live task the **first** stamp happens while
   messages stream, in `on_task_event` → `upsert_task_message`
   (`self-hosted-cloudapi/src/realtime/sio.py:187-196`). There the
   `workspace_path` is read from `registry.instance(user_id)["workspacePath"]`.

4. The registry tracks **at most one extension instance per `user_id`** — "the
   most recently registered wins" (`self-hosted-cloudapi/src/realtime/hub.py:7-8,
31-32, 56-57`). The bridge captures `workspacePath` once at start
   (`src/extension/bridge.ts:93`) and sends it in `register`
   (`packages/cloud/src/bridge/BridgeOrchestrator.ts:123-130`).

5. The live `message` event carries only `taskId` + `message` — **not** the
   worktree that produced it (`BridgeOrchestrator.ts:147-155`). The backend has
   to infer it from the global, user-keyed registry.

=> With two windows open under one cloud account, both bridges register under the
same `user_id`; the registry holds only whichever registered/reconnected last. A
task streamed from window A is stamped with window B's path. The sticky stamp
then blocks the later (correct) share/backfill value from fixing it.

## Fix

Make the worktree root travel **with** each task event. Every window's bridge
already knows its own correct `workspacePath` (its own `BridgeOrchestrator`
instance), so:

- `packages/types/src/cloud.ts` — add optional `workspacePath` to the `Message`
  `taskBridgeEvent` schema (optional => older clients still validate).
- `packages/cloud/src/bridge/BridgeOrchestrator.ts` — include
  `workspacePath: this.options.workspacePath` when emitting the `Message` event.
- `self-hosted-cloudapi/src/realtime/sio.py` — prefer the event's
  `workspacePath`, falling back to the registry instance for older clients.
  Mirrors what `events.py` backfill already does (explicit field, registry
  fallback).

## Scope / non-goals

- Stamping stays once-only & sticky — correct semantics. Already-mis-stamped
  rows do **not** self-heal; this only prevents future mis-attribution.
- No change to the single-window case (event value == register value).

## Tests

- TS: `BridgeOrchestrator` forwards `workspacePath` on the `Message` event.
- PY: an event whose `workspacePath` differs from the registered instance stamps
  the **event's** value (precedence); the registry fallback still works when the
  event omits it (existing test).
