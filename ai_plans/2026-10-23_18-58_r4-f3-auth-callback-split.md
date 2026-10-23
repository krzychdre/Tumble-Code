# R4 F3: split `auth_callback`, drop the dead organization branch

**Status:** done

**Related plans:** [maintenance audit round 4](2026-10-23_17-20_maintenance-audit-round-4.md), item F3.

## Touched files

- `self-hosted-cloudapi/src/routers/browser.py`
- `self-hosted-cloudapi/src/services/auth_service.py`
- `self-hosted-cloudapi/tests/test_sign_in_flow.py`

## Problem

`auth_callback` was 168 lines: state checks, token exchange, the userinfo-to-name mapping, ticket creation and the
client callback URL in one function. `org_id = None` (a TODO) made the `organizationId` query parameter branch
unreachable.

## Change

- `get_or_create_user(db, userinfo)` in `services/auth_service.py` takes the Authentik userinfo response and does
  the name mapping itself (given and family name, else the first and last word of `name`). The callback was its only
  caller.
- `client_callback_url(auth_redirect, ticket_code, state)` in `services/auth_service.py` builds the
  `/auth/clerk/callback?code=...&state=...` URI.
- The `org_id` placeholder and its branch are deleted. `auth_callback` is now 128 lines, the remainder being the
  state, network and redirect checks with their error pages.

## Tests

- New parametrized `test_userinfo_names_fall_back_to_the_display_name` (the mapping had no test).
- Auth families (`test_sign_in_flow`, `test_browser_auth`, `test_auth_redirect_validation`,
  `test_deployment_hygiene`, `test_remote_access`, `test_auth_cleanup`): 193 passed. Full suite: 1348 passed,
  1 xfailed. ruff clean.
- Mutation checks: last name from the second word instead of the last turns 1 test red; the callback path dropped
  turns 10 red; the query built without URL encoding turns 5 red.
