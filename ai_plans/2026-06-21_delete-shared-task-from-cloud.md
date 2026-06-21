# Delete shared task from the cloud backend (remove from DB)

**Date:** 2026-06-21
**Branch:** feature/self-hosted-remote-task-control

## Goal

Let a task owner permanently remove a shared task from the self-hosted cloud
backend — deleting the `Task` row and everything hanging off it (conversation
messages + share link) so it disappears from the web viewer and the `/shared`
link 404s.

## Decision (asked & confirmed)

Full task delete, surfaced in the **web UI only** (the `/app` task list and the
owner task-detail page). No extension-side API in this change.

## Why a full delete is clean

[`models/task.py`](../self-hosted-cloudapi/src/models/task.py): `Task.messages`
and `Task.shares` both use `cascade="all, delete-orphan"` with DB-level
`ondelete="CASCADE"`. "Remove from DB" therefore maps to deleting the `Task`.
To stay safe under async SQLAlchemy (no lazy-load of children), we delete
children explicitly, children-first, rather than relying on ORM cascade
triggering a lazy load.

## Changes

1. **`services/share_service.py`** — add
   `delete_shared_task(db, task_id, user_id) -> bool`:

    - Load the `Task`; return `False` if missing or not owned by `user_id`
      (so a non-owner / unknown id is a no-op, never another user's data).
    - Explicit `delete()` of `TaskMessage`, then `TaskShare`, then `Task`.
    - Return `True` on delete. `get_db` commits on success.

2. **`routers/web.py`** — add `POST /app/tasks/{task_id}/delete`:

    - Owner cookie session required (redirect to `/app/login` if anon).
    - Call `delete_shared_task`; redirect 303 → `/app` regardless (idempotent).
    - Add `can_delete` to the detail template context: `True` on the owner
      `/app/tasks/{id}` page, `is_owner` on `/shared/{id}` (owner viewing their
      own share link can delete; anon/non-owner cannot).

3. **Templates**

    - `tasks_list.html` — each row becomes `link + delete form`; the form POSTs
      to the delete route with a JS `confirm()` guard.
    - `task_detail.html` — a "Delete task" button (same form + confirm) in the
      header, gated on `can_delete`.

4. **`web/static/app.css`** — `.btn-delete` style (muted, red on hover) and a
   small `.task-item` flex tweak so the delete button sits beside the link.

## CSRF / safety

Session cookie is `samesite=lax`, so cross-site POSTs don't carry it — a
same-origin form POST from our own page is the only thing that authenticates.
Plus a `confirm()` dialog. Adequate for this self-hosted app.

## Tests (`tests/test_web_and_share.py`)

- delete removes the Task + its messages + its share rows (owner).
- non-owner POST is a no-op: the task and its data survive.
- unauthenticated POST redirects to `/app/login`.
- `/shared/{id}` 404s after the owner deletes the task.
