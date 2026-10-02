# Rename the ROO*CODE*_ environment variables to TUMBLE*CODE*_

Date: 2026-10-02
Branch: `refactor/rename-roo-code-env-vars` (stacked on `refactor/rename-roo-code-packages`)

Owner, 2026-10-02: rename `ROO_CODE_*` to `TUMBLE_CODE_*` "włącznie z docker compose", reading the
former name as a fallback so existing setups keep working.

## Readers (new name first, former name second)

| New                                                         | Reader                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `TUMBLE_CODE_API_URL`                                       | `packages/cloud/src/config.ts` (`getTumbleCodeApiUrl`), `apps/cli/src/commands/cli/doctor.ts` |
| `TUMBLE_CODE_DISABLE_TELEMETRY`                             | `packages/cloud/src/TelemetryClient.ts`                                                       |
| `TUMBLE_CODE_CLOUD_TOKEN`, `TUMBLE_CODE_CLOUD_ORG_SETTINGS` | `packages/cloud/src/cloudEnvironment.ts`                                                      |

Also `PRODUCTION_ROO_CODE_API_URL` -> `PRODUCTION_TUMBLE_CODE_API_URL` (cloud config + webview mirror).
`ROO_CODE_PROVIDER_URL` was dead (reader removed in D15), dropped from `.env.sample`.

## Docker compose

No compose file sets any `ROO_CODE_*` variable: neither `self-hosted-cloudapi/docker-compose.yml`
nor the live `/opt/docker/llm/docker-compose.yaml` (checked 2026-10-02). The Python server only
named `ROO_CODE_CLOUD_TOKEN` in comments; updated.

## Left as history

`.changeset/*` and `apps/cli/CHANGELOG.md` entries describing past removals, the D15 line in
`docs/09-environment-variables.md`, `ai_plans/`.

## Tests

Fallback cases: `config.spec.ts` (former API URL read, new one wins), `cloudEnvironment.spec.ts`
(former token/org names read, new ones win), `TelemetryClient.test.ts` (both off switches).
