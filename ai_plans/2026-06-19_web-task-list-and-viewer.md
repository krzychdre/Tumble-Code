# Self-hosted Cloud: web task list + read-only task viewer

**Date:** 2026-06-19
**Branch:** `feature/self-hosted-web-task-viewer` (stacked on `feature/self-hosted-cloud-backend`)
**Goal (user's words):** "see the list of tasks on web page (after backend run) and after
click on task, we should see the same flow as in Tumble Code."

---

## Context

Auth is finished (Authentik → cloud API on `:8085`, user signed in). Next: a web page listing
the user's tasks and a read-only conversation view per task. Investigation found the
extension's "share task to cloud" pipeline is **broken end-to-end on the backend** and there
is **no web frontend**. Live DB: 1 user, `tasks=0, task_messages=0, task_shares=0`.

**Decisions (user):** lightweight read-only renderer (not reusing the VS Code-coupled
`ChatRow.tsx`); list **shared tasks only**; server-rendered Jinja2 + minimal JS inside FastAPI
(no Node build).

## How task data arrives (verified)

Upload happens only on **Share** in the extension:
`ShareButton` → `shareCurrentTask` (webviewMessageHandler.ts:844) →
`CloudService.shareTask(taskId, visibility, clineMessages)` (CloudService.ts:315):

1. `POST /api/extension/share`; on **404** `TaskNotFoundError` →
2. `POST /api/events/backfill` (multipart `task.json` = full `ClineMessage[]`,
   TelemetryClient.ts:238) → retry share.

`ClineMessage`: packages/types/src/message.ts:249.

## Four blockers (each verified)

- **A. Sharing disabled (button dead).** `enable_task_sharing` comes only from org settings;
  no org → `cloud_settings=None` (settings_service.py:27) → client `canShareTask()` false →
  Share button disabled (ShareButton.tsx:128).
- **B. Wrong status code.** `share_task` returns HTTP 200 `{success:false}` (share_service.py:25)
  but client backfills only on HTTP 404 (CloudAPI.ts:97). First share silently fails.
- **C. No `Task` row.** `backfill_messages` inserts `TaskMessage` (FK → `tasks.id`) but never
  creates the parent `Task` → IntegrityError. FK `task_messages_task_id_fkey` confirmed live.
- **D. No web UI.** `share_url` = relative `/shared/{id}`, unserved; no list endpoint; auth is
  Bearer-JWT only (dependencies.py:15) — browser needs a cookie session.

## Implementation

### 1. Backend fixes (no extension changes)

- **A** `settings_service.py`: org-less → return `OrganizationCloudSettings(enable_task_sharing=
True, allow_public_task_sharing=True)`. New `enable_task_sharing: bool = True` in
  `config/settings.py` (env `ENABLE_TASK_SHARING`).
    - **A.2 (follow-up, 2026-06-20):** the Share button stayed disabled after A even with the
      correct settings live. Root cause: the extension caches org settings and only replaces them
      when `version` changes (`CloudSettingsService.fetchSettings`, version check at
      CloudSettingsService.ts:139). The org-less response hardcoded `version = 0`; the client had
      cached `version:0, cloudSettings:null` at the login _before_ A, so the new (still `0`)
      response was rejected as unchanged. Fix: org-less `version` is now content-derived
      (`_content_version` = sha256 of the cloud-settings payload → 32-bit int), so it differs from
      the stale `0` and auto-bumps on any future toggle. Client re-fetches hourly + on session
      start, so a window reload (or sign-out/in) applies it immediately.
- **B** `routers/extension.py` share: raise `HTTPException(404)` when task missing.
- **C** `services/telemetry_service.py` `backfill_messages(user_id, …)`: get-or-create
  `Task(id, user_id)`, delete existing `TaskMessage`s for the task, re-insert in order; pass
  `current_user` from `routers/events.py`.
- **share_url absolute** `services/share_service.py`: `{api_base_url}/shared/{id}`,
  manage `{api_base_url}/app/tasks/{id}`.

### 2. Browser session auth — `src/auth/web_session.py`

Reuse `generate_pkce_pair`, `get_authorize_url`, `store_oauth_state`, `get_oauth_state`,
`exchange_code_for_tokens`, `get_userinfo`, `get_or_create_user`, `create_session`. Reuse the
single `/auth/clerk/callback` redirect URI; branch on the stored `auth_redirect` marker
(`http(s)://` = web → set cookie + 302 `/app`; `vscode://` = existing bounce). Cookie
`tumble_session` = itsdangerous-signed `{session_id,user_id}`, 30-day, HttpOnly, SameSite=Lax.
`get_web_user` dependency validates the cookie + `Session.is_active`. Routes `/app/login`,
`/app/logout`.

### 3. Web router + templates — `src/routers/web.py`, `src/web/templates/`, `src/web/static/`

- `GET /app` task list (own tasks, newest first, derived title + counts).
- `GET /app/tasks/{id}` detail (session + ownership).
- `GET /shared/{id}` public target (anon if visibility public, else session).
- Lightweight renderer: parse each `TaskMessage.message_data` `ClineMessage`, render per
  say/ask type; vendored `marked` + minimal highlight CSS; dark theme like browser.py.
- Mount `Jinja2Templates` + `StaticFiles` in `main.py`; add `jinja2` dep.

### 4. Migration

`tasks` already has `user_id`; add a migration only if DDL changes. Head `b2c3d4e5f6a7`.

## Out of scope

Auto-sync all tasks; React component reuse; Authentik group→org_id mapping.

## Verification

**Status: implemented & verified (2026-06-19).**

Automated (`tests/test_web_and_share.py`, 9 new tests; full suite **29 passed**):

- B: `POST /api/extension/share` for an unknown task → **404**.
- C: `POST /api/events/backfill` creates the `Task` row + 3 `TaskMessage`s; re-share with a
  shorter set **replaces** (count 1, still 1 Task) — idempotent.
- Web: `/app` without session → **303** `/app/login`; `/app` with session lists owned tasks
  (derived title rendered); `/app/tasks/{id}` for a non-owner → **404**; `/shared/{id}`
  public → 200 anon, private → 303 login, unknown → 404.

Live smoke (uvicorn on throwaway sqlite):

- `/health` 200; `/app` → 303 `/app/login`; `/app/login` → 307 to Authentik authorize URL
  (PKCE + state present).
- `/static/app.css` 200 `text/css`; `/static/render.js` 200 `text/javascript`;
  vendored `marked.min.js` (35479 B) + `purify.min.js` (21496 B) served.
- A: `get_extension_settings(org_id=None)` →
  `cloudSettings.enableTaskSharing == true`, `allowPublicTaskSharing == true`.

Remaining manual step (needs the real extension + Authentik, not scriptable here):
sign in to the extension, run a small task, click **Share**, confirm the live log shows
`share 404 → backfill 200 → share 200` and `/app` lists it, `/shared/{id}` renders it.

## Risk / rollback

Backend changes are additive + one status-code change; revert files to restore. Web routes are
new and isolated. No `AUTHENTIK_SECRET_KEY` change. New cookie uses existing `secret_key`.
