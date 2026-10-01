# Authentik: gate Tumble Code by a group + rename the application

**Date:** 2026-06-22
**Scope:** `self-hosted-cloudapi/authentik/blueprints/`

## Goal

Two changes to the auto-provisioned Authentik blueprint, applied cleanly on a
fresh `docker compose up` (user will drop all `./.vol/*` first):

1. Provision a **group** so access to Tumble Code is controlled by group
   membership — add a user to the group → they can sign in to Tumble Code.
2. **Rename** the application's display name from `Stork Code` → `Tumble Code`.

## Background (verified against Authentik docs)

- Application access in Authentik is governed by **policy bindings** on the
  application. A binding whose `group` field is set is a plain _group-membership_
  check — no separate policy object needed.
- **Default behaviour:** an application with _no_ bindings is open to everyone.
  The moment one group binding is added, access is restricted to that group.
- **Superusers are not exempt** from application access bindings (superuser grants
  _admin_ access, not _application_ access). The bootstrap `akadmin` account — the
  one used to sign in during the extension OAuth flow — must therefore be a member
  of the group, or it gets locked out of its own app. The blueprint adds `akadmin`
  to the group on creation to prevent this.

Source: Authentik blueprint Models + Bindings overview docs.

## Changes (single file: `stork-code.yaml`)

Internal IDs stay (`slug: stork-code`, `client_id`, provider name) — these are
referenced by the api's `AUTHENTIK_APP_SLUG` / `AUTHENTIK_CLIENT_ID` and must not
change. Only the public display string changes, per the rebrand principle.

1. **New group entry** (`authentik_core.group`), id `tumble-code-group`,
   name `Tumble Code Users`, with `akadmin` added as a member via
   `!Find [authentik_core.user, [username, akadmin]]`.
2. **Application name** `Stork Code` → `Tumble Code`.
3. **New policy binding** (`authentik_policies.policybinding`) targeting the
   application (`!KeyOf stork-code-application`) with `group`
   (`!KeyOf tumble-code-group`), `order: 0`, `enabled: true` — this is what turns
   on the group gate.

## How to use after `docker compose up`

- Sign in to Authentik admin as `akadmin` (already in the group → can use Tumble
  Code immediately).
- To grant another person access: Directory → Groups → **Tumble Code Users** →
  add the user. No blueprint edit needed.

## Not changed / why

- Slug, client id/secret, provider name, `AUTHENTIK_APP_SLUG` — internal IDs the
  api builds endpoints from; renaming them would be a wider, riskier change and
  isn't what was asked.
- Blueprint filename kept as `stork-code.yaml` (internal).
