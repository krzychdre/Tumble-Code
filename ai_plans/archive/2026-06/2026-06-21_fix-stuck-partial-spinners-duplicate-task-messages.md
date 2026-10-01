# Fix stuck "active" spinners + stale "Thinking…" on the web task view

**Date:** 2026-06-21
**Branch:** `feature/self-hosted-remote-task-control`
**Symptoms (user's words):** some conversation blocks are highlighted as if currently active
(spinning) when nothing is running; the live-header summary says "Thinking…" and never shows
tokens / context length.

---

## Root cause (proven with evidence, not assumed)

Queried the live Postgres `stork_code.task_messages` directly:

- **7 duplicate `(task_id, message_ts)` groups**, up to **4 rows each**, all `partial: true`.
- ts `1782038135062` → 3 rows, text lengths **2 / 6 / 9**: successive partial _reasoning_ chunks
  of one logical message that should have collapsed into a single upserted row.
- `reasoning, partial=true` = 19 of the last 60 rows; also `tool` and `command_output` affected.

Why the duplicates exist and never finalize:

1. `task_messages` has **no unique constraint** on `(task_id, message_ts)` — only plain indexes
   (migration `c3d4e5f6a7b8` added the column + index but no uniqueness).
2. `upsert_task_message()` (telemetry_service.py) does a **non-atomic SELECT → INSERT/UPDATE**, each
   bridge event in its own `async_session_factory()` session. Reasoning streams emit many
   `say("reasoning", …, partial=true)` Message events back-to-back; the relay handler
   (`sio.on(TASK_EVENT)`) awaits between SELECT and INSERT, so concurrent partials all miss the
   not-yet-committed row and **each INSERTs a new row**.
3. Once ≥2 rows share a ts, the finalizing `partial:false` update calls `scalar_one_or_none()`,
   which raises `MultipleResultsFound`. sio.py catches it under `except Exception` ("persistence
   must never break the live relay") and **silently drops the finalize** → the rows stay
   `partial:true` permanently.

That one bug drives **both** reported symptoms:

- **Spinners:** `render.js` sets `active = !!m.partial || !!info.active`, so every stuck
  `partial:true` row gets `.running` (spinner + highlight) forever.
- **"Thinking…" + no tokens:** `getActivity()` returns the newest active row's label
  (`reasoning → "Thinking…"`); `live.js refreshActivity()` shows it. Token/context come only from a
  live `instanceState` (none when the extension is offline), so they stay "—" while the stale row
  keeps the activity pinned to "Thinking…".

## Changes

### Backend — fix the root cause (atomic, race-proof collapse)

**New Alembic migration** `d4e5f6a7b8c9_task_messages_unique_ts` (revises `c3d4e5f6a7b8`):

- Dedup existing rows (Postgres only — SQLite test DBs start clean): keep the longest
  `message_data` per `(task_id, message_ts)` (the finalized/most-complete copy), tie-break by `id`,
  delete the rest. `WHERE message_ts IS NOT NULL` so null-ts backfill rows are untouched.
- Create **unique index** `uq_task_messages_task_ts` on `(task_id, message_ts)`. NULL ts stays
  distinct in both Postgres and SQLite, so legacy/backfilled rows still append.
- `downgrade()` drops the unique index.

**`telemetry_service.upsert_task_message()`** — replace SELECT-then-write with a dialect-native
upsert keyed on the new unique index:

- `INSERT … ON CONFLICT (task_id, message_ts) DO UPDATE SET message_data = EXCLUDED.message_data`
  via `postgresql.insert` / `sqlite.insert` (both support the same construct; branch on
  `db.bind.dialect.name`).
- ts `None` → no conflict target matches → plain append (unchanged backfill behaviour).
- Keep the get-or-create-Task + cross-user guard exactly as today.
- This removes the `scalar_one_or_none()` `MultipleResultsFound` path entirely.

### Frontend — defense in depth (history replay must not animate)

A loaded conversation snapshot is point-in-time history; only _subsequently streamed_ live events
should animate. This both fixes the visible symptom for any already-corrupted rows and is correct
on its own.

**`render.js`**

- `upsert(m, opts)` gains an `opts.history` flag: when set, `active` is forced `false` (the row is
  not registered in `activeByTs`). Live socket events keep calling `upsert(m)` with no flag, so
  genuine streaming still spins and the in-place finalize still clears it.
- `renderAll(messages)` passes `{ history: true }`.
- Net effect: on load `getActivity()` returns `null` → the `/shared` static page never spins, and
  the live header falls back to `isRunning` ("Working…") instead of a phantom "Thinking…".

## Out of scope

- Header tokens/context when the extension is offline: there is no live `instanceState` to source
  them, so "—" is correct. Once the activity indicator stops lying, this is no longer confusing.
- Reworking the bridge relay's per-event session model.

## Verification

- `uv run pytest` green (existing bridge/web/share tests unchanged).
- New test: `upsert_task_message` called repeatedly for one ts (created → partials → final
  `partial:false`) yields exactly **one** row whose stored `partial` is `false`.
- Re-run the DB dup query after migration → 0 duplicate `(task_id, message_ts)` groups.
- Manual: reload a finished task → no spinners, header shows no "Thinking…" when idle; drive a live
  task → the streaming tail spins and clears on finalize.
