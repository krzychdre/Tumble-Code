# Persist `workspacePath` on tasks → show project/worktree in cloud web view

Date: 2026-06-21
Branch: stacks on `feature/self-hosted-remote-task-control` (depends on the
unmerged "task list on cloud web view" commit `82e4b0a1b`; main does not have it).

## Problem / evidence

The cloud web view never shows which project/worktree a task belongs to.

Traced the data flow end to end:

- The extension **does** capture the worktree root: `vscode.workspace.workspaceFolders[0].uri.fsPath`
  → `workspacePath` (src/extension/bridge.ts:93), emitted on `extension:register`
  (packages/cloud/src/bridge/BridgeOrchestrator.ts:127; schema packages/types/src/cloud.ts:411).
- Server stores it **in-memory only**, per user, newest-wins:
  ConnectionRegistry `_instance_by_user[user_id]["workspacePath"]`
  (self-hosted-cloudapi/src/realtime/hub.py:56-62, accessor :76). Never persisted.
- The `tasks` table has no workspace/cwd/path column at all
  (self-hosted-cloudapi/src/models/task.py).
- The two Task-creation paths both create `Task(id, user_id)` with nothing else:
    - live bridge: `upsert_task_message` (services/telemetry_service.py:117),
      called from realtime/sio.py:190 (has `user_id`).
    - share/backfill: `backfill_messages` (services/telemetry_service.py:48),
      called from routers/events.py:70.
- The backfill `properties` form field (TS getTelemetryProperties) carries only
  `gitProperties` — `repositoryName` is identical across worktrees of one repo,
  so it cannot identify a worktree. The absolute `workspacePath` is the correct key.

So the only authoritative server-side source of the worktree path is the
registry instance for the user, which is populated by the bridge.

## Design decision (chosen)

Source `workspace_path` with an explicit-first, registry-fallback strategy:

- **Live bridge** (`upsert_task_message`): from `registry.instance(user_id)["workspacePath"]`.
  This is the only available source and is authoritative — events only flow while
  the bridge is connected, so the registry is always populated here.
- **Share/backfill** (`backfill_messages`): **explicit client field first** — the
  extension sends `workspacePath` in the backfill FormData — with the registry as
  a **fallback** for older clients that don't send it. This gives 100% coverage
  even when the bridge is OFF at share time.

This is consistent with what already crosses to the self-hosted server (the bridge
already sends the absolute `workspacePath`), and `getRooCodeApiUrl()` points at the
self-hosted cloud API in this fork.

Implementation surfaces for the explicit field (small, backward-compatible):

- packages/types/src/telemetry.ts: add OPTIONAL `getTelemetryWorkspacePath?(): string | undefined`
  to `TelemetryPropertiesProvider` (optional → no break for other implementers).
- src/core/webview/ClineProvider.ts: implement it returning `this.cwd`
  (`currentWorkspacePath || getWorkspacePath()`), already defined.
- packages/cloud/src/TelemetryClient.ts `backfillMessages`: append `workspacePath`
  to the FormData from `this.providerRef?.deref()?.getTelemetryWorkspacePath?.()`
  (only when non-empty). NOT added to general telemetry `properties` — kept out of
  the per-event payload to avoid leaking an absolute path into every event.

Write semantics: set `workspace_path` when it is currently NULL (on Task create,
or on a later event for a pre-existing task that predates this feature). Never
overwrite a non-null value — a task does not change worktrees.

## Changes

1. **Model** — self-hosted-cloudapi/src/models/task.py
   Add `workspace_path = Column(String, nullable=True)` to `Task`.

2. **Migration** — new alembic/versions/e5f6a7b8c9d0_task_workspace_path.py
   `down_revision = "d4e5f6a7b8c9"` (current head).
   upgrade: `op.add_column("tasks", sa.Column("workspace_path", sa.String(), nullable=True))`
   downgrade: `op.drop_column("tasks", "workspace_path")`.

3. **Ingestion** — services/telemetry_service.py

    - Add optional `workspace_path: str | None = None` param to `upsert_task_message`
      and `backfill_messages`.
    - On get-or-create, set `task.workspace_path = workspace_path` when creating.
    - For an existing task whose `workspace_path` is NULL and a value is now known,
      set it (one-time backfill of legacy rows). Guard: only when non-empty.

4. **Callers**

    - realtime/sio.py (`on_task_event`, ~:188): resolve
      `ws = (registry.instance(user_id) or {}).get("workspacePath")` and pass to
      `upsert_task_message(..., workspace_path=ws)`.
    - routers/events.py (`backfill_events_endpoint`, ~:70): resolve the same from
      `registry.instance(current_user["user_id"])` and pass to `backfill_messages`.
      (Import the `registry` singleton from src.realtime.sio / hub.)

5. **Web view** — routers/web.py

    - Add a small helper `_workspace_label(path)` → basename for compact display
      (full path kept for the tooltip/header).
    - task_list (~:219): add `"workspace": task.workspace_path` and
      `"workspace_label": _workspace_label(task.workspace_path)` to each item dict.
    - task_detail (~:300): pass `task` already in context (template can read
      `task.workspace_path`); add a derived label to context for the header.

6. **Templates / static**

    - templates/tasks_list.html: render a `badge badge-muted` with the basename and
      `title="{{ t.workspace }}"` (full path on hover) in `.task-meta`, when present.
    - templates/task_detail.html: show the worktree path in the header block
      (full path; truncate with CSS if needed).
    - static/app.css: minor style for the new label if needed (reuse existing
      `.badge`/`.task-date` styling; avoid new classes unless necessary).

7. **Tests** — tests/test_web_and_share.py
    - Live path: simulate a registered extension instance with a `workspacePath`,
      drive a task event, assert the persisted Task row has `workspace_path` and the
      `/app` + detail pages render the basename/full path.
    - Backfill path: register instance, POST /api/events/backfill, assert persisted
      `workspace_path`.
    - Null path: a task created with no registry instance → `workspace_path` NULL,
      page renders without the badge (no crash).
    - One-time backfill: pre-existing NULL row gets populated on a later event.

## Verification (done)

- `python -m pytest` in self-hosted-cloudapi: **73 passed** (incl. 4 new — live
  stamp, legacy-NULL backfill + no-overwrite, explicit backfill field, registry
  fallback; 2 new web-render: list badge + full-path detail, and null-renders-clean).
- Migration upgrade/downgrade roundtrip proven on SQLite in isolation (adds then
  drops `tasks.workspace_path`); `alembic heads` shows a single head `e5f6a7b8c9d0`.
  (Full-chain SQLite upgrade is blocked by a pre-existing Postgres-only timezone
  migration, unrelated to this change.)
- `turbo check-types` for tumble-code + @roo-code/types + @roo-code/cloud: clean.
- `@roo-code/cloud` vitest: **278 passed** (TelemetryClient suite now 26, +2 for the
  explicit workspacePath field present/absent).

## Out of scope

- Live-cockpit header display of `instance.workspacePath` (that data already
  reaches the browser in the join ack; separate "option 1" branch).
- Multi-root workspaces: only `workspaceFolders[0]` is captured (extension-side,
  pre-existing limitation).
