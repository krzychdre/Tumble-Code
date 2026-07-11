# CB-8: Enforce org task-sharing and public-sharing policy server-side in share_task

**Date:** 2026-07-12
**Branch:** `fix/share-org-policy-enforcement`
**Finding:** CB-8 [med]

## Problem

`share_task` in `self-hosted-cloudapi/src/services/share_service.py` relied
entirely on the extension client's `canSharePublicly()` / task-sharing
enablement checks. A direct `POST /api/extension/share {visibility:"public"}`
bypassed org policy entirely — the server created the share without consulting
the org's `enable_task_sharing` or `allow_public_task_sharing` flags.

## Root Cause

Org settings exist server-side in the `OrganizationSettings` model
(`src/models/settings.py`, lines 19-20):

- `enable_task_sharing` (Boolean, default True)
- `allow_public_task_sharing` (Boolean, default True)

The settings are served to the extension via `GET /api/extension-settings`
(`src/services/settings_service.py`), but `share_task` never consulted them.
The `Task` model carries `organization_id` (nullable FK to `organizations`),
so the linkage was available — just unused.

## Fix

### `src/services/share_service.py`

After the ownership check passes (line 27), added a policy enforcement block:

1. If `task.organization_id` is set, query `OrganizationSettings` by org_id.
2. If a settings row exists:
    - `enable_task_sharing=False` → reject ANY share with error "Task sharing
      is disabled for this organization".
    - `allow_public_task_sharing=False` + `visibility="public"` → reject with
      "Public task sharing is disabled for this organization".
    - `visibility="organization"` is still allowed when only public is disabled.
3. If no settings row exists → allow (permissive default).

**Permissive default:** When `task.organization_id` is None (no org) or no
`OrganizationSettings` row exists for the org, all sharing is allowed. This
preserves back-compat for existing self-hosted deployments that never
configured org settings. The model defaults (True/True) are also permissive,
so a freshly-created row allows sharing — only an explicit `False` triggers
rejection.

### `src/routers/extension.py`

Updated the error-mapping in `share_task_endpoint`:

- "Task not found" → HTTP 404 (unchanged)
- Errors containing "disabled for this organization" → HTTP 403 (new)

The 403 is non-leaking: the service only returns policy errors AFTER the
ownership check passes, so the caller has already proven they own the task.
A non-owner still gets the 404 "Task not found" response.

## Tests Added

In `tests/test_web_and_share.py` (4 new tests, 90 total):

1. `test_share_public_rejected_when_org_disallows_public` — org with
   `allow_public_task_sharing=False`, owner shares `visibility="public"` →
   403, no share row created.
2. `test_share_organization_allowed_when_org_disallows_public` — same org,
   `visibility="organization"` → 200 (still allowed).
3. `test_share_all_visibilities_rejected_when_sharing_disabled` — org with
   `enable_task_sharing=False`, both visibilities → 403.
4. `test_share_allowed_when_no_org_settings_configured` — org with no
   `OrganizationSettings` row, both visibilities → 200 (permissive default).

## Pre-fix Failure Confirmation

Tests 1 and 3 failed pre-fix (share succeeded with 200 instead of 403).
Tests 2 and 4 passed (no enforcement existed, so permissive paths worked).

## Verification

```
.venv/bin/python -m pytest tests/ -q
90 passed in 1.95s
```

## Files Changed

- `self-hosted-cloudapi/src/services/share_service.py` — policy enforcement
- `self-hosted-cloudapi/src/routers/extension.py` — 403 error mapping
- `self-hosted-cloudapi/tests/test_web_and_share.py` — 4 new tests
