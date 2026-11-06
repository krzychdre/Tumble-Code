# Cloud API: share links named by a random token (audit 2026-11-06, A-3)

**Status:** done on `fix/sec-share-token`
**Touched:** `self-hosted-cloudapi/src/models/task.py`, `alembic/versions/b5c6d7e8f9a0_task_share_token.py` (new),
`src/services/share_service.py`, `src/services/task_access.py`, `src/routers/shared.py`, README, `docs/08-cloud.md`,
tests.

## Problem

`share_task` built `share_url = f"{base}/shared/{task_id}"` (`src/services/share_service.py`), so the task id was the
link's secret and a re-share after "Stop sharing" revived every copy of the revoked link.

## Fix

- `task_shares.share_token` (`secrets.token_urlsafe(32)`, NOT NULL, unique index `uq_task_shares_share_token`), new on
  every share, on the insert and on the ON CONFLICT re-share update alike. `share_url` carries the token, so the
  extension (it copies `shareUrl` from the response) and the owner's task page (it shows the stored `share_url`) need
  no change.
- `/shared/{share_token}` and `/shared/{share_token}/images` resolve the share by token (`shared_view_access`);
  `/shared/{task_id}` links stop working (owner decision; the live DB held one public share).
- Migration `b5c6d7e8f9a0` (after `a1c2e3f4b5d6`): adds the column, gives each row a fresh token, rewrites its stored
  `share_url` to it, then NOT NULL + unique index.

## Tests

Re-share test: three shares give three links, only the last opens, the revoked ones and `/shared/<task id>` answer 404
(red without the token in the re-share update, and red when the lookup goes back to the task id). Migration data test
(token per row, link rewritten, unique). Existing share fixtures carry a `share_token` and open the page by it.

## Notes

Two racing share calls each return their own token; the last update wins, so one caller's link may be dead. Acceptable
for a double click. Applied by `db-migrate.sh` at the next api container start; api image rebuild owed.
