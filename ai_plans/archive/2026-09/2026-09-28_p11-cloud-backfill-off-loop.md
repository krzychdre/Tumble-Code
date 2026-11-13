# P11: cloud backfill off the event loop, bridge partial rows coalesced

Roadmap item: `ai_plans/2026-09-27_simplification-roadmap.md`, **P11**.

> Problem: "Cloud backfill runs on the event loop: only the JSON parse is
> off-loaded; classification and metrics for up to 10 MB of messages run
> inline, one ORM insert per row. The bridge commits once per streamed chunk."
> Fix: "Build the rows in a worker thread and insert in one statement;
> debounce partial rows per `(task, ts)` by ~250 ms (finals stay immediate)."

Branch: `perf/p11-cloud-backfill-off-loop` (off main @ 6f1e86c9f). Code lives in
`self-hosted-cloudapi/` (FastAPI + SQLAlchemy 2.0.54 + python-socketio; tests on
in-memory SQLite, production on PostgreSQL/asyncpg).

## 1. Claims checked on main @ 6f1e86c9f

| Claim                                 | Verdict            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only the JSON parse is off-loaded     | confirmed          | `src/routers/events.py:114` runs `_parse_backfill_upload` via `anyio.to_thread.run_sync`; nothing else in the route or service is off-loaded.                                                                                                                                                                                                                                                                                          |
| Classification and metrics run inline | confirmed          | `src/services/telemetry_service.py:242` `classify_conversation(parsed)`, `:250-254` the ts de-dup walk, `:256-273` `json.dumps` + `message_metrics` per message, `:283-284` `derive_title`/`derive_prompt`: all synchronous inside `async def backfill_messages` (`:184`).                                                                                                                                                             |
| One ORM insert per row                | **partly refuted** | `:265-273` builds one `TaskMessage` ORM object per message and `db.add`s it, but at SQL level the unit of work already batches: a probe counting `before_cursor_execute` on a 50-message backfill saw **one** `INSERT INTO task_messages ... VALUES` execution (insertmanyvalues, 600 bound parameters). The per-row cost is Python-side on the loop (object construction, identity map, flush bookkeeping), not a round trip per row. |
| The bridge commits once per chunk     | confirmed          | `src/realtime/sio.py:238-240` (known owner) and `:247-248` (unknown owner) call `_save_message` per event; `_save_message` (`:262-281`) opens a session, runs `upsert_task_message` and commits (`:277`). Streamed partials carry the whole accumulated text under one `ts`, so each chunk is a full-row rewrite in its own transaction.                                                                                               |

### Loop-stall measurement (real conversations from this machine)

A ticker task sleeping 2 ms records the longest gap between its wake-ups while
`backfill_messages` runs on in-memory SQLite (probe script, not committed). Three
runs each, same venv, main checked out in a throwaway worktree:

| Conversation           | main: max loop stall | branch: max loop stall |
| ---------------------- | -------------------- | ---------------------- |
| 405 messages, 10.0 MB  | 103 / 92 / 83 ms     | 19 / 18 / 16 ms        |
| 783 messages, 6.8 MB   | 85 / 83 / 84 ms      | 16 / 18 / 18 ms        |
| 1,998 messages, 6.1 MB | 130 / 128 / 140 ms   | 26 / 18 / 17 ms        |

(Cold first runs on main reached 222-307 ms.) On main the block is the
synchronous stretch classify + dump + metrics + ORM construction + `db.add`;
phase timings for the 1,998-message task: classify 47 ms, ORM `add` 35 ms,
metrics 17 ms, flush 128 ms (partly in aiosqlite's thread).

## 2. Design

### Backfill

- New pure function `_build_backfill_rows(task_id, messages)`
  (`telemetry_service.py:184`) holds the old loop body unchanged: classify the
  whole conversation, keep one row per `ts` holding the later message
  (DEF-C49), `json.dumps` each payload, `message_metrics` each row, and derive
  title and prompt. It returns plain dicts, all with the same keys.
- `backfill_messages` keeps everything that touches the session on the loop
  (get-or-create task, ownership check, workspace stamp, tree link, DELETE),
  then `await anyio.to_thread.run_sync(_build_backfill_rows, ...)` (`:290`) and
  `await db.execute(insert(TaskMessage), rows)` (`:296`), guarded by `if rows`
  (an empty executemany is not valid).
- Why executemany and not `insert().values(rows)`: a single multi-VALUES
  statement would bind rows x 12 parameters and pass SQLite's (32,766) and
  asyncpg's (32,767) bound-parameter limits at ~2,700 rows. The executemany form
  lets SQLAlchemy page the parameters itself on both dialects. Column defaults
  (`id` = `msg_...`, `created_at`) are Python callables applied per row by Core.
- The ORM bulk path creates no `TaskMessage` objects, so nothing lands in the
  session's identity map; nothing read them there before either.

### Bridge

New `src/realtime/partial_buffer.py`, `PartialMessageBuffer`, one process
singleton `partial_messages` in `sio.py:322`.

- `on_task_event`, known-owner path, calls `_persist` (`sio.py:267`):
    - partial with a `ts`: `hold()`; the chunk is still relayed at once;
    - anything else (final, no `partial` flag, or no `ts`): `settle(task, ts)`
      drops the held partial of that `ts`, waits for a write of it already under
      way, and returns the task's other held partials; those and the final go
      to `_save_messages` in **one** transaction.
- Unknown-owner path writes at once, even a partial: that write creates the
  task row and answers the ownership question the relay needs.
- Window: 250 ms (`FLUSH_DELAY_S`), fixed from the first held chunk, not reset
  by later ones, so a long stream is still written once per window.
- Held revision: replaced only when the new payload's JSON is at least as long,
  the same rule as the upsert's `WHERE length(excluded) >= length(stored)`
  guard. Chunks can be handled out of order (socket.io runs handlers as
  separate tasks), so "latest" and "fullest" are not the same.
- `disconnect(sid)` writes that socket's held rows before detaching;
  the lifespan calls `flush_pending_messages()` after `sio.shutdown()` and
  before `engine.dispose()` (`main.py:106`).
- A held write whose save reports a foreign task marks the socket's cache
  (`_write_held`, `sio.py:315`), as the immediate path did.

## 3. Invariants (each pinned by a test)

`tests/test_backfill_bulk_insert.py`, `tests/test_event_loop_offload.py`:

1. Rows are built off the loop (spy records no running loop in the caller).
2. No `TaskMessage` ORM object is constructed (mapper `init` event).
3. One INSERT execution for 200 messages (characterization: main already
   had one).
4. Stored rows identical to the ORM path: payload, ts, `q_kind`, `tool_path`,
   five metric columns, distinct `msg_` ids, `created_at`, task title, count,
   tokens; one row per `ts` (later message), string and ts-less messages kept.
5. Re-upload replaces; empty upload stores nothing.

`tests/test_bridge_partial_coalescing.py`:

6. Five partials inside the window: five relays, zero commits, then one.
7. The fullest revision is the one written.
8. A long stream is written mid-stream (window not reset per chunk).
9. A final is written at once with one commit and supersedes held partials.
10. A final takes the task's other held partials along (one commit, both rows).
11. A final without a `partial` flag is immediate.
12. Disconnect writes the socket's held rows; shutdown writes all held rows.
13. A partial for a task of unknown owner is written at once and relayed.

Red run on main: 2 backfill tests fail (no builder, ORM objects built); the
bridge tests fail on the missing buffer, and a behavior-only copy (buffer calls
stubbed out) fails 5 of 8 on behavior (5 commits for 5 chunks, 4 commits for
3 partials + final, 2 commits for final + other partial, rows already written
before disconnect and shutdown).

## 4. Residuals

- **Crash loses up to 250 ms of a partial.** A process killed without running
  the lifespan (SIGKILL, OOM) loses the held revision of a streaming row. The
  row's final revision, which the extension always sends, is written at once,
  so this only matters for a stream that never finishes; the web view reads
  live chunks from the socket, not from the database.
- **The history in the database lags a live stream by up to one window.** A
  page reload mid-stream can show a revision up to 250 ms older than before.
- **`settle` waits only for the newest write under way of a `ts`.** Two
  overlapping held writes of the same `ts` need a window shorter than one
  write; the length guard still keeps the fuller one, and a final still always
  wins in the database.
- **A late partial after a final is held and written later.** Same outcome as
  before: the length guard rejects it unless it is longer than the final
  (which only happens across the `"partial":true` boundary, a pre-existing
  edge documented on `upsert_task_message`).
- **Remaining ~20 ms stall per backfill**: parameter processing of the bulk
  INSERT and the summary refresh still run on the loop. Not worth a thread.
- **Multiple workers.** The buffer is per process. The bridge already assumes
  one process (the registry is in memory), so this adds no new constraint.
- Not changed: the live path's per-message `_live_quality_kind` lookup and the
  summary refresh on finals (already final-only, see `_refresh_after_live_write`).
