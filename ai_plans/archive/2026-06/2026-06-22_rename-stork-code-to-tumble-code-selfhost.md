# Rename `stork-code` → `tumble-code` in self-hosted cloud

**Date:** 2026-06-22
**Scope:** `self-hosted-cloudapi/` only

## Goal

Align the self-hosted cloud stack's Authentik app identity with the
Roo Code → Tumble Code rebrand. Rename the public-facing Authentik slug /
client id / application / blueprint name from `stork-code` to `tumble-code`.

## What changes

Replace the **hyphenated** string `stork-code` → `tumble-code` everywhere:

- `authentik/blueprints/stork-code.yaml` → renamed to `tumble-code.yaml`;
  internal ids (`stork-code-provider`, `stork-code-application`), names, slugs,
  `client_id` default, and the `!KeyOf` references all become `tumble-code*`.
- `.env`, `.env.example`, `.env.backup` — `AUTHENTIK_APP_SLUG`,
  `AUTHENTIK_CLIENT_ID`, and the blueprint-path comment.
- `docker-compose.yml` — `AUTHENTIK_APP_SLUG` / `AUTHENTIK_CLIENT_ID` defaults.
- `README.md` — blueprint filename references.
- `config/settings.py` — `authentik_app_slug` Field default.

## What does NOT change

- `.env.backup:13` `DATABASE_URL=...@localhost:5544/stork_code` — the **DB name**
  (underscore) points at the real existing Postgres database on the host.
  Renaming the string without renaming the DB would break the connection, so
  it's left as-is. Not a "stork-code" app mention.
- The blueprint is bind-mounted by directory (`./authentik/blueprints:/blueprints/custom`),
  so renaming the file does not affect compose wiring.

## Note for operators

After this change, the Authentik OAuth2 provider/application slug becomes
`tumble-code`. The extension's OAuth client config (`AUTHENTIK_CLIENT_ID`) and
any existing Authentik state must use the new slug; a fresh blueprint apply
creates the new app. An already-provisioned `stork-code` app in a running
Authentik will need re-provisioning or manual slug update.
