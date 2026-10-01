# CLI: Mistral --base-url only applied to Codestral models

Status: done (branch `fix/cli-mistral-base-url`), item A5 of `ai_plans/2026-10-01_simplification-round-2.md`.

## Touched files

- `apps/cli/src/lib/utils/provider-types.ts`
- `apps/cli/src/lib/utils/__tests__/provider-types.test.ts`
- `apps/cli/README.md` (provider env var table)
- `docs/09-environment-variables.md`
- `.changeset/cli-mistral-base-url.md`

## Problem

`providerEnvMap.mistral` (`apps/cli/src/lib/utils/provider-types.ts`) mapped `--base-url` / `baseUrl` to
`mistralCodestralUrl` and advertised `MISTRAL_BASE_URL`. The Mistral handler (`src/api/providers/mistral.ts:71-72`)
reads `mistralCodestralUrl` only when the model id starts with `codestral-`; every other model goes to
`https://api.mistral.ai`. So the flag was accepted and silently ignored for the default and most Mistral models.

## Fix

Remove `baseUrlField` and `baseUrlEnvVar` from the mistral entry. `getProviderSettings` then throws its existing
"Provider 'mistral' does not support a base URL" error, which `run` reports at startup and exits 1 (path covered by
the xai case in `run.test.ts`, "rejects --base-url for a provider without a base-url field"). The fallback reader in
`vscode-config.ts` also stops taking `mistralCodestralUrl` from the CLI's own extension state as a base URL.
README table and `docs/09-environment-variables.md` no longer list `MISTRAL_BASE_URL`.

## Tests

`provider-types.test.ts`: "rejects --base-url for mistral instead of dropping it" (fails on origin/main's
provider-types.ts) replaces the test that asserted the old mapping.

## Notes / caveats

- A user who really ran a `codestral-*` model through a custom Codestral endpoint via the CLI loses that path. The
  item chose loud failure over a partial mapping; the VS Code settings still carry the Codestral URL for the extension.
- Found while checking: `getBaseUrlFromEnv` (`provider-types.ts`) is called only from tests, so none of the
  `*_BASE_URL` variables in the README table and `docs/09-environment-variables.md` is read by a CLI run today. Not
  changed here (separate item).
