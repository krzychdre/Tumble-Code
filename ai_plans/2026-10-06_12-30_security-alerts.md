# Security alerts 2026-10-06: dependency audit and CodeQL

Status: done on `fix/security-alerts-2026-10-06`

## Problem (evidence)

`Dependency audit` (scheduled, run 37314488093) failed on high advisories in axios (<1.20.0, eight GHSAs: ReDoS,
prototype pollution gadgets, HTTP/2 proxy bypass, redirect SSRF) and lodash-es (<=4.17.23, `_.template` code
injection). A local `pnpm audit --prod` on 2026-10-06 added critical/high advisories in simple-git (<=3.36.0 and
<4.0.1), @simple-git/argv-parser (<2.0.1) and proxy-addr (<2.0.8).

Sources: `src` asked for `axios ^1.18.0` (1.18.1 installed); lodash-es 4.17.23 is pinned by chevrotain 11.1.2
under mermaid; proxy-addr 2.0.7 comes from express 5 under @modelcontextprotocol/sdk; simple-git 3.36.0 is a
direct `src` dependency used by the checkpoint service.

CodeQL alerts #34/#35 (`js/bad-code-sanitization`): `apps/cli/scripts/integration/cases/cloud-login-and-telemetry.ts`
pasted `JSON.stringify(logFile)` into the generated fake-browser script.

## simple-git 4 trap

v4 throws when `.env()` is given a variable from its `GitEnvKeys` list (`@simple-git/argv-parser`).
`createSanitizedGit` passes the whole process env minus `BLOCKED_ENV_KEYS`, which lacked `VISUAL` and
`GIT_CONFIG_PARAMETERS`. With `VISUAL=vim` the checkpoint spec failed with
`Use of "VISUAL" is not permitted without enabling allowUnsafeEditor`, so every checkpoint would have failed for
a user with that common shell setting. v4 also dropped the default export.

## Fix

- `src/package.json`: `axios ^1.20.0`, `simple-git ^4.0.2`.
- root `pnpm.overrides`: `lodash-es ^4.18.1`, `proxy-addr ^2.0.8`.
- `ShadowCheckpointService.ts`: named `simpleGit` import; `VISUAL` and `GIT_CONFIG_PARAMETERS` added to
  `BLOCKED_ENV_KEYS`.
- The fake browser script finds `browser.log` through its own `__dirname`; no value is pasted into code.

## Tests

- The blocked-env checkpoint spec now also sets `VISUAL` and `GIT_CONFIG_PARAMETERS` (failed before the list
  change, passes after). All checkpoint specs pass.
- `pnpm audit --prod | node scripts/audit-gate.mjs` exits 0.
- `check-types`, the esbuild bundle, the provider/fetcher/marketplace/code-index specs (axios users) and the
  `cloud-login` CLI integration cases pass.
