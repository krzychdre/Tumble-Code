# Cloud API compose: settings.py is the single source of defaults (A8)

Status: done on `fix/cloudapi-compose-single-defaults`, PR open.

## Touched files

- `self-hosted-cloudapi/docker-compose.yml` (api service environment)
- `self-hosted-cloudapi/config/settings.py` (unused `authentik_app_slug` removed)
- `self-hosted-cloudapi/.env.example`, `self-hosted-cloudapi/authentik/blueprints/tumble-code.yaml` (slug comments)
- `self-hosted-cloudapi/tests/test_compose_settings_defaults.py` (new)
- `docs/09-environment-variables.md`

## Problem

- `docker-compose.yml:15-47` (api `environment`) repeated about 24 defaults of `config/settings.py` as
  `${VAR:-default}`, and one had drifted: `BRIDGE_ENABLED: ${BRIDGE_ENABLED:-false}` while `settings.py:251` says
  `bridge_enabled = True` and `.env.example` plus `docs/09` say true. A stack without `BRIDGE_ENABLED` in `.env` ran
  with the bridge off.
- `SECRET_KEY` and `JWT_SECRET` had placeholder fallbacks (`change-me-...`) that `_check_secret` (`settings.py:19-30`)
  refuses at startup anyway, so the fallback only turned "compose refuses" into "api restarts in a loop".
- `authentik_app_slug` (`settings.py:121`) is read by nothing in `src/` or `config/` (`git grep app_slug`). The
  premise that the Authentik blueprint reads `AUTHENTIK_APP_SLUG` is wrong: the blueprint hardcodes
  `slug: tumble-code` and its `!Env` tags read only `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`,
  `AUTHENTIK_REDIRECT_URI` and `WEB_PUBLIC_URL`; the `auth_server` environment never carried `AUTHENTIK_APP_SLUG`. The
  api uses only the global `/application/o/{authorize,token,userinfo}/` endpoints (`config/auth.py:112-166`).

## How pydantic-settings treats an empty string

Checked with the service venv (pydantic-settings 2.15.0): `env_ignore_empty` defaults to false, so
`BRIDGE_ENABLED=""` is a value and fails with `bool_parsing`; `PORT=""` fails the same way for int. So
`VAR: ${VAR:-}` would break every typed default. A bare name in the compose `environment` (`PORT:` with no value) is
resolved by Compose from the shell and the project `.env` and is left out of the container when unset (compose-go
`MappingWithEquals.Resolve(...).RemoveEmpty()`), so the settings.py default applies. `env_file: .env` was rejected
because it would copy every infra secret (`AUTHENTIK_SECRET_KEY`, `AUTH_PG_PASS`, bootstrap password) into the api
container.

## Fix

The api environment now has three kinds of entries:

1. Values the compose stack decides: `DATABASE_URL` (its Postgres) and `AUTHENTIK_INTERNAL_URL`
   (`http://auth_server:9000` fallback).
2. Fields with no settings.py default: `SECRET_KEY` and `JWT_SECRET` as `${VAR:?set VAR in .env ...}`;
   `API_BASE_URL`, `AUTHENTIK_BASE_URL`, `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_REDIRECT_URI` keep the bundled stack's
   localhost fallbacks (they must agree with the `auth_server` blueprint environment).
3. Every other Settings field by bare name, now including the ones compose never passed (`BRIDGE_PATH`,
   `ENABLE_TASK_SHARING`, `ALLOW_PUBLIC_TASK_SHARING`, `RETENTION_SWEEP_*`).

`AUTHENTIK_APP_SLUG` is gone from settings.py, compose, `.env.example` and docs/09; the blueprint comment now says the
slug is fixed.

## Tests

`tests/test_compose_settings_defaults.py` parses the api service environment, resolves it the way Compose does for a
given `.env`, and loads `Settings` from the result: every compose key is a Settings field; no compose default for a
field with a settings.py default; with only the two secrets set every optional field equals its settings.py default
(`bridge_enabled` is True); `.env` values still reach the api; a missing secret stops compose; an empty string fails
validation (why bare names). Five of the seven fail against the old compose file. Whole cloudapi suite: 952 passed,
1 xfailed.

## Notes for operators (what to check in `.env`)

- The live stack (containers `self-hosted-cloudapi-*`) runs from the compose file in the live checkout, not from
  `/opt/docker/llm/docker-compose.yaml`, which has no api service. It changes only on the next
  `docker compose up -d` after this lands.
- `SECRET_KEY` and `JWT_SECRET` must be set in `.env`, or `docker compose up` stops with a message. (With
  `JWT_ALGORITHM=RS256` the bundled compose still asks for `JWT_SECRET`; set any 32+ character value.)
- `BRIDGE_ENABLED`: without it in `.env` the bridge is now ON (was off through compose). Put `BRIDGE_ENABLED=false`
  in `.env` to keep it off.
- An empty optional key in `.env` (for example `PORT=` or `BRIDGE_ENABLED=`) is now passed as an empty string and
  fails validation, exactly as in a local `uv run`; delete the line instead to get the default. String fields
  (`CORS_ORIGINS=`, `WEB_PUBLIC_URL=`, `WEB_ALLOWED_NETWORKS=`, `AUTHENTIK_CLIENT_SECRET=`) accept empty as before.
- `AUTHENTIK_APP_SLUG` in an existing `.env` is ignored (`extra="ignore"`); it can be deleted.
- The healthcheck and the published port still fall back to 8085 when `PORT` is unset.
