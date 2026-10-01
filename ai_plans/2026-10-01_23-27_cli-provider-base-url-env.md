# A13: the CLI ignores the documented `*_BASE_URL` environment variables

**Status:** done on `fix/cli-provider-base-url-env` (simplification round 2, item A13).

## Touched files

- `apps/cli/src/lib/utils/provider-config.ts`
- `apps/cli/src/lib/utils/__tests__/provider-config.test.ts`
- `apps/cli/README.md`, `docs/09-environment-variables.md`
- `.changeset/cli-provider-base-url-env.md`

## Problem

`apps/cli/README.md` ("For providers whose schema has a base-url setting, the CLI also honors a `*_BASE_URL`
environment variable") and `docs/09-environment-variables.md` (section "CLI provider keys") promise that
`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `OLLAMA_BASE_URL` and the rest are read. They were not:
`getBaseUrlFromEnv` (`apps/cli/src/lib/utils/provider-types.ts:241`) had no caller outside
`provider-types.test.ts`, and `resolveProviderConfig` (`provider-config.ts:119-120,142` at `65fdaba16`) took the base
URL from the layers (settings file, mode override, flags) or the CLI's extension state only. The API key, resolved a
few lines below (`provider-config.ts:124-136`), already used its env var.

## Fix

`resolveProviderConfig`, the one place both the startup configuration and every per-mode configuration are resolved
(`run.ts` calls it for each), now resolves the base URL in the same order as the API key: a layer of the active
provider (flag above settings file or mode override), then `getBaseUrlFromEnv(provider)`, then the fallback (the CLI's
own extension state) of the same provider. An empty variable counts as unset, as for the key. Only the active
provider's variable is read, so `OPENAI_BASE_URL` never reaches anthropic. The env var names exist only for providers
with a base-url field (`providerEnvMap`), so `toProviderSettings` never throws for an env-supplied URL.

## Tests

`provider-config.test.ts`, "base URL": env var used when no layer sets one and over the fallback (anthropic and
openai), settings and flag win over it, another provider's var is ignored, an empty var counts as unset, and the URL
reaches the extension settings (`openAiBaseUrl`). The two env-only cases fail on the old code (checked). The spec's
`beforeEach` now clears `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` so a developer's shell cannot leak into it.
Full `apps/cli` suite with `--maxWorkers=2`, tsc, eslint, prettier, knip.

## Notes

- openai and openai-native share `OPENAI_BASE_URL` (as they share `OPENAI_API_KEY`); only one is active per run.
- Behaviour change for users who have such a variable exported for another tool: the CLI now follows it unless the
  settings file or a flag sets a base URL. This is what the docs said all along; the changeset says it.
