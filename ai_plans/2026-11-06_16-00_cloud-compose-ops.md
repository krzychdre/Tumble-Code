# Cloud API compose: stop grace period and loopback-only Authentik DB (audit 2026-11-06, A-15, A-16)

**Status:** done on `fix/sec-cloud-ops`
**Touched:** `self-hosted-cloudapi/docker-compose.yml`, `README.md`, `docs/08-cloud.md`, `tests/test_deployment_hygiene.py`.

## Problem

- A-15: uvicorn drains for 25 s (`docker-entrypoint.sh`), but the `api` service had no `stop_grace_period`, so
  `docker compose stop/down` SIGKILLed it at Docker's 10 s default.
- A-16: `auth_db` published `5544:5432` on every interface, so Authentik's Postgres was reachable from the LAN.

## Fix

- `stop_grace_period: 30s` on `api`; a test pins it above the entrypoint's drain.
- `auth_db` publishes `127.0.0.1:${AUTH_DB_PORT:-5544}:5432`: host tools keep working, the LAN loses access.
- Not changed: the api Postgres `roo:password` (not published, compose network only; an env var with the same
  default would add an option nobody sets) and `auth_worker` running as root with the Docker socket (Authentik's
  upstream compose layout, used to manage outposts; owner decision).

## Notes

Takes effect the next time the owner recreates `api` / `auth_db` (`docker compose up -d`); nothing was restarted.
