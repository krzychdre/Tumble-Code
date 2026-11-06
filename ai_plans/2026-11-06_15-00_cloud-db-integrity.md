# Cloud API: membership uniqueness and atomic ticket redemption (audit 2026-11-06, A-2, A-7)

**Status:** done on `fix/sec-cloud-db`
**Touched:** `self-hosted-cloudapi/src/models/organization.py`, `alembic/versions/a1c2e3f4b5d6_unique_memberships.py` (new),
`src/services/auth_service.py`, tests (`test_migration_drift.py`, `test_cloud_races.py`, `test_sign_in_flow.py`).

## Problem

- A-2: `memberships` had no unique `(user_id, organization_id)`; `membership_of` (`services/organizations.py`) reads one row
  with `db.scalar`. The sync is serialized by an in-process `asyncio.Lock` only, so two processes on one database could
  insert the same pair.
- A-7: `validate_ticket` selected an unused ticket, then set `used` by primary key. Two concurrent
  `POST /v1/client/sign_ins` with one ticket on Postgres both read it unused and both minted a client token.

## Fix

- Model `Index("uq_memberships_user_org", ..., unique=True)`; migration `a1c2e3f4b5d6` deletes all but the oldest row
  of each pair (portable `DELETE ... WHERE EXISTS`), then creates the index. Live DB had 0 duplicates on 2026-11-06.
  No `on_conflict_do_nothing` in the sync: a second process now fails its sync loudly and the next tick retries.
- `validate_ticket` is one `UPDATE tickets SET used = true WHERE code = :c AND used = false AND expires_at > now
  RETURNING session_id`.
- OAuth state (`get_oauth_state`) left as is: a duplicate callback still needs Authentik's single-use code, so the race
  cannot mint twice.

## Tests

Migration data test (oldest kept, duplicate insert refused); drift test covers the model index; concurrent ticket
redemptions (file SQLite, parked after the read) give exactly one session; expired ticket 401. Each red with its fix
reverted.

## Notes

Applied by `db-migrate.sh` (`alembic upgrade head`) at the next api container start. api image rebuild owed.
