# Cloud API: auth hygiene (security audit 2026-11-06, A-4, A-5, A-17; docs A-14, A-18)

**Status:** done on `fix/sec-cloud-auth`
**Touched:** `self-hosted-cloudapi/src/services/{auth_service,retention_scheduler,telemetry_service,share_service}.py`,
`src/main.py`, `src/routers/browser.py`, `README.md`, tests (`test_auth_cleanup.py`, `test_task_organization.py`).

## Problem

- A-4: `purge_expired_auth_rows` ran only inside the retention loop, which `lifespan` starts only with
  `RETENTION_SWEEP_ENABLED=true`; with it off, OAuth state rows and tickets grew forever.
- A-5: a new task row took the token's org claim with no membership check. The claim is checked when a token is
  issued, but a bridge socket keeps its handshake token as long as it stays connected, so a user removed from an
  organization kept filing new tasks into it (`src/realtime/sio.py` -> `_save_messages` -> `_get_or_create_task`).
- A-17: a failed token exchange logged no redirect_uri.

## Fix

- `run_auth_purge_loop` (hourly) in `auth_service`, started unconditionally in `lifespan`; removed from the
  retention loop.
- `_get_or_create_task` checks `is_member_of` before inserting with an organization (one indexed lookup per new
  task, none per message); a non-member's new task goes to the personal space. Existing rows never move.
- The token-exchange error log includes the redirect_uri. No "start again" page: the callback host is the
  authorize request's redirect_uri host (Authentik redirects there), so a mismatch needs a proxy rewriting `Host`.
- Docs: README states that public sharing is on by default (A-18) and that re-sharing restarts the expiry (A-14);
  `share_task` docstring says the same.

## Tests

Lifespan with the retention sweep off starts the purge loop; a removed member's new bridge task lands in the
personal space. Both red with the fix reverted. Existing org tests now seed the membership they rely on.

## Notes

Server-only; api image rebuild owed. No migration, no `.env` change.
