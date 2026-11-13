# Telemetry: a retried event is stored and counted once (audit 2026-11-06, A-12)

**Status:** done on `fix/sec-telemetry-dedupe`
**Touched:** `packages/cloud/src/TelemetryClient.ts`, `self-hosted-cloudapi/src/models/event.py`,
`alembic/versions/c6d7e8f9a0b1_telemetry_client_event_id.py` (new), `src/schemas/telemetry.py`, `src/routers/events.py`,
`src/services/telemetry_service.py`, tests.

## Problem

The client's retry queue re-sends `POST /api/events` after a timeout, a 5xx or a network failure, also when the first
request was committed. `record_event` (`telemetry_service.py`) inserted every copy, so an LLM Completion landed twice
in `telemetry_events` and in `usage_rollup`. Events carried no client-side id to dedupe on.

## Fix

- Client: `CloudTelemetryClient.capture` posts `{ ...event, clientEventId: crypto.randomUUID() }`. The retry queue
  stores the serialized body, so every retry carries the same id (also across a restart, the queue is persisted).
- Server: `telemetry_events.client_event_id` (nullable) + unique index `uq_telemetry_events_user_client_event`
  `(user_id, client_event_id)`, migration `c6d7e8f9a0b1` (after `b5c6d7e8f9a0`). `TelemetryEventRequest` accepts
  `clientEventId`. `record_event` is one `INSERT ... ON CONFLICT DO NOTHING RETURNING`; on a repeat it returns before
  the task client stamp, relation, model label and `add_to_rollup`. NULLs never conflict, so older clients keep
  working without dedupe. `event_row` became `event_values` (a dict for the insert; the test helper builds the row).
- Backfill does not go through `record_event` and is unchanged (it replaces a task's messages, idempotent already).

## Tests

Server (SQLite and Postgres via `RECALL_PG_URL`, both run): the same id three times is one row and one rollup count; id-less
events count every time; another user's event with the same id lands. Route test: `clientEventId` reaches the column,
id-less bodies still answer 200. Red when the id is not stored. Client: two captures get different ids, a failed send
re-sent by the real `RetryQueue` carries the first id (red with a constant id).

## Notes

Needs the api image rebuild (migration runs at start) and an extension + CLI release for the client half. Until then
events arrive without an id and behave as before.
