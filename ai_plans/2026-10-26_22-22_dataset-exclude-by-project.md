# Dataset page: leave out projects, not folders (2026-10-26)

**Status:** implemented on `fix/dataset-exclude-by-project`, stacked on `feat/recall-projects` (`45ad37f29`).
**Related plans:** `2026-10-26_18-22_cross-session-recall.md` (sections 1 and 2: tenants, projects, bindings),
`2026-10-02_llm-exchange-dataset.md` (the dataset page and the export).
**Touched:** `self-hosted-cloudapi/src/services/projects.py`, `src/services/exchange_ingest.py`,
`src/services/dataset_overview.py`, `src/services/dataset_export.py`, `src/web/templates/dataset.html`,
`alembic/versions/c1d2e3f4a5b6_bind_seen_folders.py`, `tests/test_projects.py`, `tests/test_dataset_export.py`,
`tests/test_migration_drift.py`, `tests/test_phone_layout.py`.

## Symptom

The owner: the "Leave out projects (a client's code stays out)" list on `/app/dataset` lists every worktree and is
far too long; a worktree is just its project and should be offered as that project. On the live database
(2026-10-26) the list had 465 entries: 403 of them agent worktrees under `/home/krzych/.roo/worktrees/`.

## What was happening

- `services/dataset_overview.py:110-122` (before) grouped the user's exchanges by `llm_exchanges.workspace_path`, and
  `dataset.html:138-144` offered each path as an `exclude_workspace` checkbox.
- `services/dataset_export.py:117-123` and `_TaskRenderer.selected` (before) left out exchanges whose path was in
  the list, so excluding a repository meant ticking every one of its worktrees.
- Projects (`models/project.py`, `services/projects.py`) bind a folder only when a window reports it
  (`extension:register`, `GET /api/recall/context`). An agent's worktree runs tasks without a window, so its folder
  is never bound. Live: of the 467 (user, tenant, folder) triples in `tasks` and `llm_exchanges`, 414 have no
  `repositoryUrl` in the telemetry of any of their tasks; 393 of those are worktrees of `private-things`, a
  repository without a remote, and every worktree task has a parent task (`task_relations`) in the main folder.
- The extension reports `repositoryUrl` in telemetry before the first exchange of a task (193 of 193 tasks with
  both), but not always before the task row appears (120 of 385 task rows were created first).

## Fix

- **One mapping rule** (`projects.exchange_binding`): an exchange is the project its user's folder is bound to in
  its tenant, `project_bindings (user_id, tenant_id = coalesce(organization_id, user_id), workspace_path)`, read
  through the unique binding index. It follows merges on `/app/projects` without touching the exchanges. An
  exchange without a folder belongs to no project and cannot be left out (as before).
- **The page** lists projects (name, tasks, exchanges); the checkbox sends `exclude_project=<id>`.
- **The export** drops every task with an exchange in a left-out project, in the `task_ids` query. Whole tasks,
  because an exchange that is not a target still reaches a later sample as an earlier turn; a task has one folder,
  so this is what the per-exchange check did in practice, minus that leak.
- **Going forward** (`projects.bind_recorded_folder`, called by `exchange_ingest.record_exchange` for a newly
  stored full snapshot with a folder): an unbound folder becomes the project of the remote the task's latest
  telemetry event named; without one, the project of the parent task's folder in the same tenant (the exchange
  carries `parentTaskId`); without that, a folder project. The key and name come from
  `new_project_identity`, which `resolve_project` uses too. Cost: deltas (most exchanges) run nothing, because
  their chain's snapshot bound the folder; a snapshot of a bound folder runs one point lookup on the unique
  binding index; an unbound folder runs that lookup and one query with two indexed scalar subqueries
  (`telemetry_events.task_id`, `llm_exchanges (user_id, task_id)`) before the inserts `resolve_project` also does.
  The task row is not the binding point: its telemetry may not have arrived yet, which would make a repository's
  worktree a folder project for good.
- **History** (alembic data migration `c1d2e3f4a5b6`, after `b0c1d2e3f4a5`): the same order of evidence over every
  (user, tenant, folder) of `tasks` and `llm_exchanges`; the remote is the one the folder's tasks named last, the
  parent comes from `task_relations`. It reuses `tenant_of` and `new_project_identity`, keeps existing bindings and
  projects, then stamps `tasks.project_id` from the bindings. A migration, like the telemetry backfill of
  `a7b8c9d0e1f2`: it runs once on every existing deployment at upgrade, and a fresh (create_all) database has no
  history to bind. Telemetry is streamed (`yield_per`): the matching events hold 217 MB on the live database.
- **Stored exclusion:** there is none to migrate. The exclusion was never stored (`DatasetSettings` holds only the
  recording switch and the terms); it lived in the export form's query string.

Measured on a copy of the live folder, telemetry and relation data run through the migration: 467 folders become
24 projects (`private-things` 383 folders, `Tumble-Code` 33, `Game` 19, then repositories and folders with one
or a few each). By the remote alone, without the parent rule, it would be about 420.

## Tests

- `test_projects.py`: the remote the task's telemetry named last, of the same user, claiming the task row; a
  worktree without a remote joining its parent's project only in the same tenant (parametrized); a bound folder
  creating no second project; the overview counting an exchange in its own user's project when a colleague and the
  personal space bind the same path elsewhere.
- `test_dataset_export.py`: a worktree exchange with `parentTaskId` recorded through the API; the page offers one
  project with both tasks and 5 exchanges, and `exclude_project` drops both tasks from the export.
- `test_migration_drift.py`: the migration on SQLite from `b0c1d2e3f4a5`: two folders of one repository are one
  project, the latest remote across a folder's tasks wins, a worktree inherits only in its tenant, a folder without
  evidence is a folder project, an existing binding stays, tasks follow their folder.
- `test_phone_layout.py`: the dataset page's project list with a long unbroken project name.
- Mutations seen red: each of the three conditions of `exchange_binding`; the tenant condition of the parent lookup;
  the telemetry user condition and its newest-first order; the early return for a bound folder; ignoring the
  parent's project; the ingest call; the export exclusion; the overview join; in the migration the latest remote across
  tasks, the event order, the tenant check of the parent, the parent rule, the preload of existing bindings and
  projects, the task update; a non-wrapping project name on the phone.
- Not covered by a test: skipping deltas at ingest (only the query count changes).

## Notes

- The parent rule is beyond the bare `services/projects` rules (binding, remote, folder). Without it the list stays
  near 420 entries, because worktrees of a repository without a remote never report one.
- A project name can repeat across tenants (personal and an organization); the list shows names only.
- Task rows of a folder only the bridge reports (recording off, no window) stay unbound until a window or a
  recording reports the folder.
