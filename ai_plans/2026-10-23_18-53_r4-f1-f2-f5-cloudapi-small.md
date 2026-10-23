# R4 F1, F2, F5: cloud API owner lookup, models label split, own-data check

**Status:** done

**Related plans:** [maintenance audit round 4](2026-10-23_17-20_maintenance-audit-round-4.md), items F1, F2, F5.

## Touched files

- `self-hosted-cloudapi/src/services/task_access.py`
- `self-hosted-cloudapi/src/services/model_attribution.py`
- `self-hosted-cloudapi/src/services/telemetry_service.py`
- `self-hosted-cloudapi/src/routers/task_images.py`
- `self-hosted-cloudapi/src/routers/web_tasks.py`
- `self-hosted-cloudapi/src/realtime/sio.py`

## Problem

- F1: `select(Task.user_id).where(Task.id == task_id)` plus an owner comparison was written out in the image upload
  route, the task image route, `refresh_task_models` and the bridge's `_task_access`, with a variant in
  `_user_owns_task`.
- F2: splitting a stored `tasks.models` label into names was written three times (`_filter_suggestions`,
  `models_badge`, `note_completion_model`).
- F5: `upsert_task_message` checked `isinstance(message, dict)`, but its only production caller,
  `sio._save_messages`, receives events that `on_task_event` already checked (`is_message`), directly or through
  the partial buffer, which only holds events from the same path.

## Change

- `task_owner(db, task_id) -> Optional[str]` in `services/task_access.py`; the five sites call it. An unknown task
  gives None, which never equals a user id, so the owner checks keep their 404 for unknown and foreign tasks.
  `task_detail` and `shared_view_access` load the whole `Task` row and stay as they are.
- `split_models_label(label)` in `services/model_attribution.py`; the three sites call it.
- The `isinstance` check in `upsert_task_message` is deleted.

## Tests

- Touched families (`test_model_attribution`, `test_bridge`, `test_task_images`, `test_bridge_partial_coalescing`,
  `test_web_tasks`, `test_client_kind`, `test_task_row_race`): 198 passed. Full suite: 1345 passed, 1 xfailed.
  ruff clean.
- Mutation checks: `split_models_label` without `strip()` turns 2 tests red; `task_owner` selecting `Task.id`
  instead of `Task.user_id` turns 20 tests red.
