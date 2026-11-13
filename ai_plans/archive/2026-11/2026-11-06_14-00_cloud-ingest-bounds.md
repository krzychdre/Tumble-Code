# Cloud API: ingest bounds (security audit 2026-11-06, A-1, A-13, A-20)

**Status:** done on `fix/sec-cloud-ingest`
**Touched:** `self-hosted-cloudapi/src/routers/{events,llm_exchanges,upload_gate}.py`,
`src/services/task_images.py`, `config/settings.py`, `.env.example`, `docs/09-environment-variables.md`, tests.

## Problem

- A-1: `POST /api/events` is outside the per-IP limit and declared its body as a parameter. FastAPI
  reads and JSON-parses a declared body before dependencies run (`fastapi/routing.py`, `app()` reads
  `request.json()` before `solve_dependencies`), so an anonymous caller could make the API parse
  50 MiB bodies, unthrottled, before the 401. `POST /api/events/backfill` (50 MiB, signed in) had
  no bound on how many uploads are held in memory at once, unlike the LLM exchange uploads
  (`ParseGate`).
- A-13: two LLM exchange parses at once by default, each up to 128 MiB inflated plus several
  times that as objects.
- A-20: `store_task_image` hashed up to 10 MB on the event loop.

## Fix

- `/api/events` reads its body by hand after the Bearer check (the `error_reports` pattern), with
  its own cap `MAX_EVENT_BYTES = 16 MiB` (largest of 336 827 live events: 5 156 172 bytes). Still
  `json.loads` + `model_validate`, because pydantic's JSON parser refuses lone surrogates that
  `test_hostile_clients` sends. Invalid JSON is now 400 (was FastAPI's 422).
- `_CappedRoute` is gone; both handlers call `capped_request` explicitly.
- `ParseGate` moved to `routers/upload_gate.py` with `upload_slot(user_id)`; the backfill reads and
  parses its form inside it, sharing the one memory budget with the exchange uploads.
- `LLM_EXCHANGE_PARSE_CONCURRENCY` default 2 -> 1 (names kept: no `.env` change).
- Image hash runs in `anyio.to_thread`.

`/api/events` itself is not gated: it carries every streamed partial message, and sharing a
capacity-1 gate with a 128 MiB exchange parse would stall the live bridge.

## Tests

`test_backfill_size_cap.py`: anonymous event refused with 401 and zero body reads; event over
`MAX_EVENT_BYTES` 413; backfill while the user's slot is taken 429. `test_event_loop_offload.py`:
image hash off the loop. Each proved red with its fix reverted.

## Notes

Server-only change; api image rebuild owed. No migration, no `.env` change.
