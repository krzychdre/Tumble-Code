# Concurrent telemetry events race on task_relations: investigation & fix

**Status:** fixed on `fix/cloud-relation-insert-race`
**Related plans:** `2026-10-09_bridge-misses-editor-tab-tasks.md` (found in the same logs)
**Touched:**

- `self-hosted-cloudapi/src/services/task_tree.py` (`record_relation`)
- `self-hosted-cloudapi/tests/test_relation_race.py` (new)

## Symptom

The api log of 2026-10-09 shows repeated `POST /api/events HTTP/1.1" 500` with
`duplicate key value violates unique constraint "task_relations_pkey"`, for example
`Key (child_task_id)=(01a12102-143f-7750-9232-617d29249623) already exists`, a subtask
of the LC_PRO run. The event in that request was lost until the client queue retried it.

## What was happening

Every telemetry event of a subtask carries `taskId` and `parentTaskId`, and
`record_event` calls `record_relation` for each. `record_relation` looked the link up and
inserted it when missing. A new subtask fires several events at once (Task Created, the
first Task Message, an LLM Completion), each in its own request and transaction, so two
of them could both miss the lookup and both insert. The loser hit the primary key and the
whole request rolled back, the telemetry event with it.

## Fix

The insert is a dialect-native `INSERT ... ON CONFLICT (child_task_id) DO NOTHING`, the
pattern `_get_or_create_task` already uses for `tasks` (DEF-C48). The loser keeps the
winner's row, which holds the same link: a task never changes parent. The lookup stays in
front so the common case (link already stored) is one SELECT. Dialects without
`ON CONFLICT` keep the plain insert.

## Tests

`tests/test_relation_race.py` replays the race deterministically like
`tests/test_task_row_race.py`: a statement hook commits the same relation from a second
connection right before our INSERT. It fails on `main` and passes with the fix. A second
test checks two events record one relation and two events. Full suite: 1318 passed.

## Caveats

The live api image must be rebuilt for the fix to take effect.
