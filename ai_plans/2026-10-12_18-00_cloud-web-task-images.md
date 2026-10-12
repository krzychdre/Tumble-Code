# Cloud web panel: show the images a conversation points to

Status: done on `feat/cloud-web-task-images-v2`

## Problem

The owner reported (2026-10-12) that the cloud web panel does not show images that the CLI draws in the
same conversation. Evidence from the live `task_messages` table: the messages carry Markdown image
references with workspace-relative paths, for example

    ![Ryzyko rozładowania baterii PV](monitoring/pv-bateria-ryzyko-rozladowania-2026-10-12.png)

(task `01a1306f-...`, `say: text` and `completion_result`). The CLI resolves the path against the task's
working directory and reads the file from disk (#856). The cloud only ever receives the message text,
so `marked` turns the reference into `<img src="monitoring/...png">`, which the browser resolves against
`/app/tasks/<id>` and gets a 404. The bytes never left the user's machine. Images already sent as data
URLs in `ClineMessage.images` (pasted screenshots, browser shots) do render; this is only about images
referenced by path in the text.

## Contract

**Upload (client to server):** `POST /api/tasks/{taskId}/images`, `Authorization: Bearer <session token>`,
multipart form fields:

- `messageTs`: the `ts` of the message whose text holds the reference (integer, as text),
- `path`: the reference target exactly as written in the Markdown (`monitoring/x.png`, `./a b.png`,
  `/abs/path.png`), not the resolved absolute path,
- `file`: the bytes, with the image MIME type.

Answers: `204` stored (an existing row for the same `(task, messageTs, path)` is replaced), `404` the task
does not exist or belongs to someone else, `413` over 10 MB, `415` not one of PNG, JPEG, GIF, WebP
(sniffed from magic bytes, the declared type is not trusted). SVG is refused: an SVG opened directly is a
document that can run script.

**Serve (server to browser):** `GET /app/tasks/{taskId}/images?ts=<messageTs>&path=<urlencoded path>`
with the same access rules as the task page, and `GET /shared/{task_id}/images?ts=&path=` for a shared task.
Response: the bytes with the stored MIME type, `X-Content-Type-Options: nosniff`, a private cache header;
`404` when nothing was uploaded.

**Render:** `static/render.js` rewrites an `<img>` whose `src` is a local path (not `http:`, `https:`,
`data:`, not starting with `/app/` or `/shared/`) to the serve URL for that message's `ts`. If the image
fails to load (not uploaded yet, or never), it is retried once after a few seconds (a live row can be drawn
before the upload lands) and then replaced by a small text placeholder naming the path.

## Client side (`packages/cloud`)

After a `TASK_MESSAGE` event for a non-partial message is sent, and for every message of a backfill, the
client scans `text` for `![alt](target)` references with a local target, resolves the target against the
task's workspace path (`getTelemetryWorkspacePath()`, absolute targets as they are), and uploads files that
exist, have an image extension and are at most 10 MB. A per-client memo of `(taskId, ts, path, mtime,
size)` keeps a file from being sent twice. Failures are logged and dropped, never retried in a loop and
never thrown into the task.

## Server side (`self-hosted-cloudapi`)

New table `task_images` (`id`, `task_id` FK to `tasks.id` ON DELETE CASCADE, `message_ts`, `path`,
`mime`, `size`, `sha256`, `data` bytes, `created_at`), unique `(task_id, message_ts, path)`. The schema
comes from `create_all` on a fresh database; an alembic revision adds it to existing ones. Deleting a task or the retention sweep removes the
images with it.

## Changes

Server and web (`self-hosted-cloudapi`):

- `src/models/task.py`: `TaskImage` (`task_images`), unique index `uq_task_images_task_ts_path`, FK
  CASCADE to `tasks`. Exported from `src/models/__init__.py`.
- `alembic/versions/f8a9b0c1d2e3_task_images.py`: the same table for existing deployments. Needed after
  all: `tests/test_migration_drift.py` fails on a model table without a migration (a FRESH database still
  gets it from `create_all`).
- `src/services/task_images.py`: magic-byte sniffing (PNG, JPEG, GIF, WebP), upsert with ON CONFLICT on
  the unique index, lookup. Caps: 10 MB file, 1024 UTF-8 bytes of path (the path is in a btree index).
- `src/routers/task_images.py`: `POST /api/tasks/{task_id}/images` (bearer auth, owner check before the
  body is read, body capped while it streams through `events.capped_request`, file read with
  `read(MAX + 1)`); 204 / 404 / 413 / 415, plus 400 for a missing or non-integer `messageTs`, an empty
  or too long `path`, or no file. `image_response()` for both serve routes: stored MIME,
  `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=3600`, bare 404 when absent.
- `src/routers/web_tasks.py`: `GET /app/tasks/{task_id}/images?ts=&path=` (owner only, like the page).
  `src/routers/shared.py`: `GET /shared/{task_id}/images?ts=&path=` with `shared_view_access` (the
  shared URL carries the task id, not a token). Both pages pass `image_base` to the template, which
  puts it on `#conversation` as `data-image-base`. The CSP already allows `img-src 'self'`.
- `src/services/share_service.delete_tasks`: deletes `task_images` explicitly, like the other children
  (the retention sweep goes through it). `retention_service.plan_sweep` adds the image sizes to the
  reclaimed bytes.
- `src/web/static/render.js`: `upsert()` passes every row body through `localImages()`, which rewrites
  `<img>` with a local src (no scheme, not `//`, not `/app/`, `/shared/`, `/static/`; absolute
  filesystem paths and drive letters count as local) to `<base>?ts=&path=` with `decodeURI(src)` as the
  path, on an inert `<template>` after DOMPurify. Live rows go through the same `upsert()`. One
  capture-phase `error` listener retries a failed local image once after 3 s (cache-busting `retry`
  parameter), then replaces it with `<span class="img-missing">image not uploaded: <path></span>`
  (textContent). `app.css`: `.msg-body img` capped at the row width, `.img-missing` muted.
- Tests: `tests/test_task_images.py` (17), `tests/browser/images_checks.html` (14 checks), route table
  and route boilerplate updated for the three routes.

Client (`packages/cloud`):

- `src/taskImages.ts`: `findLocalImageReferences` (every `![alt](target)`, bare or `<...>`, title
  dropped, `decodeURI` applied so the path matches what the page asks for; schemes and `//host` skipped,
  a drive letter is local) and `locateTaskImage` (resolve against the workspace, PNG/JPEG/GIF/WebP by
  extension, regular file, at most 10 MB).
- `src/TelemetryClient.ts`: after a non-partial `TASK_MESSAGE` is posted, and for every message after a
  successful backfill, the references are uploaded in the background with the same gates as messages
  (telemetry on, task sync on, signed in). A memo of `taskId|ts|path|mtimeMs|size` (5000 entries) sends
  a file once; a network error, 5xx, 429 or 404 (task row not there yet) forgets the entry so a later
  send of the message retries, other refusals are final.
- Tests: `taskImages.spec.ts` (14), `TelemetryClient.taskImages.spec.ts` (8).
