# Cloud API README: title, architecture link, endpoint list (E3, cloud part)

Status: done on `docs/cloudapi-readme`, PR open. Stacked on `chore/cloud-remove-dead-endpoints` (B6, PR #679),
which already removed the deleted endpoints from the same README list.

## Touched files

- `self-hosted-cloudapi/README.md`
- `ai_plans/self-hosted-cloud-api-architecture.md` moved to `ai_plans/archive/` (`git mv`)

## Problem

- Title and intro still said "Self-Hosted Roo Code Cloud API" and "Roo Code VS Code extension".
- `README.md:295` linked `ai_plans/self-hosted-cloud-api-architecture.md`, a May plan that describes the removed
  LLM proxy (`proxy.py`, `ROO_CODE_PROVIDER_URL`). The current description of the service is docs/08-cloud.md.
- The hand-written endpoint list (`README.md:269-296`) had drifted: it omitted the web panel, the bridge, health,
  `/auth/error`, `/app/login`, `/app/logout`, and listed routes B6 deletes.
- The extension settings section named `roo-cline.cloudApiUrl` / `roo-cline.clerkBaseUrl`; the settings are
  `tumble-code.cloudApiUrl` / `tumble-code.clerkBaseUrl` (`src/package.json:462,470`), and the "production Clerk"
  is `https://auth.tumblecode.dev` (`packages/cloud/src/config.ts:1`), not `clerk.roocode.com`.

## Fix

Retitle to Tumble Code with a one-paragraph description; point Architecture at docs/08-cloud.md; replace the endpoint
list with a pointer to `tests/test_route_table.py` (the pinned, always-current route table) and a short grouped list
checked against it; correct the setting names and the production Clerk URL. The old plan goes to `ai_plans/archive/`;
the dated plan docs that mention it are historical and keep their text.

## Tests

Docs only: prettier check on the README; every route in the short list checked against `EXPECTED` in
`tests/test_route_table.py`.
