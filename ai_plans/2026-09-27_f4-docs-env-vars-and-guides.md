# F4 — Docs: environment variable table + "how to add a setting / tool / provider"

Roadmap item F4 of [`ai_plans/2026-09-27_simplification-roadmap.md`](2026-09-27_simplification-roadmap.md)
(including the D15 reference: cloud URLs spread over five-plus env vars, two of them dead). Docs-only change:
no production code was touched.

Branch: `docs/f4-env-vars-and-extension-guides` off `main` (2026-09-27, after F1–F3 were merged).

## Deliverables

- [`docs/09-environment-variables.md`](../docs/09-environment-variables.md) — every variable the code reads, grouped
  by workspace (extension, CLI runtime contract, CLI provider keys, agent-interchange, self-hosted cloud API, tests
  and tooling), plus a section on the dead variables and one on settings-vs-environment precedence.
- [`docs/10-adding-things.md`](../docs/10-adding-things.md) — file-by-file checklists for adding a setting, a tool
  and a provider.
- Index rows for both in [`docs/README.md`](../docs/README.md) (level 3), and a cross-link from
  [`docs/04-tools-and-providers.md`](../docs/04-tools-and-providers.md) ("Adding a provider today").

## Methodology

1. `grep -rnoE "process.env.NAME"` over `src`, `apps`, `packages`, `scripts`, excluding `node_modules`, `dist/`,
   `__tests__` and `.spec.` files; plus the bracket form `process.env["NAME"]` (which found the `CLI_RUNTIME_ENV`
   constants), `import.meta.env` in the webview (none found), the pydantic `Settings` fields in
   `self-hosted-cloudapi/config/settings.py`, the docker-compose environment block and `.env.example`.
2. Every variable was traced to its reader(s) to determine what it actually does and whether anything consumes the
   value — dead variables are ones whose getter/constant has no consumer outside tests.
3. Numbers: ~60 distinct variables documented across the six groups (18 extension, 6+2 CLI contract/endpoints,
   12 provider key vars + 12 base-URL vars summarized by table, 6 agent-interchange, ~35 cloud API incl. infra-only
   compose keys, 9 tests/tooling). Standard OS variables (`HOME`, `USERPROFILE`, `APPDATA`, `PROGRAMDATA`, `SHELL`,
   `PATH`) and SDK-chain variables (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`) are deliberately excluded and the
   exclusion is stated on the page.

## Findings — dead variables (confirms D15)

- **`ROO_CODE_PROVIDER_URL`** — `getRooCodeProviderUrl` (`packages/cloud/src/config.ts`) has no caller outside tests
  since the cloud proxy provider was removed. `src/activate/cloud-urls.ts` still pushes the `cloudProviderUrl`
  setting into the runtime override, so the override machinery is live but nothing reads the value.
- **`ROO_SDK_BASE_URL` / `SDK_BASE_URL`** — the old tRPC SDK client was deleted (D6); the only remaining import of
  `lib/sdk/index.js` is type-only (`User` in `apps/cli/src/agent/extension-host.ts`). `ROO_AUTH_BASE_URL`
  (`AUTH_BASE_URL`) is still live: `tumble auth login` builds its sign-in URL from it.

These match D15's "two of them dead". Removing them is a code change (D6/D15), out of scope for a docs PR.

## Residuals

- `POSTHOG_API_KEY`/`POSTHOG_HOST` default to a local collector URL (`http://localhost:8080/telemetry`) — looks like
  a leftover from a dev setup being the hardcoded default in `PostHogTelemetryClient.ts`. Not changed (docs PR);
  worth a look when D6/D15 cleanup happens.
- `ENABLE_TASK_SHARING`, `ALLOW_PUBLIC_TASK_SHARING`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`,
  `RETENTION_SWEEP_ENABLED`, `RETENTION_SWEEP_HOURS` exist in `settings.py` but are not in the compose environment
  block (only in `.env.example` partially) — documented as settings.py-only; whether compose should expose them is
  a cloud-api decision, not docs.
- `FORWARDED_ALLOW_IPS` is uvicorn's own variable; documented because `network_access.py` references it, but it is
  not part of the pydantic settings.
- The `.env.example` middle section (between `AUTHENTIK_APP_SLUG` and `CORS_ORIGINS`) was elided in one read; the
  variables there (`AUTHENTIK_CLIENT_ID/SECRET`, `AUTHENTIK_REDIRECT_URI`) were cross-checked against
  `settings.py` and compose, so the table is complete.
- `docs/10-adding-things.md` step lists were derived from the tables' types and existing docs (04/architecture/06)
  rather than by performing an addition; if a step is stale, the same-PR docs rule fixes it on the next real
  addition.
- S4 (provider-descriptor-driven generation) will shrink the provider checklist to ~1 step; the page says "roughly
  15 files today" and links the roadmap.

## Verification

- `pnpm knip` run and compared against main's baseline (exit 1 pre-existing on main; no new findings).
- No code changed, so no tests were added (test-placement guidance does not apply to markdown-only PRs); the
  changeset is patch-level per repo convention (docs get changesets too).
