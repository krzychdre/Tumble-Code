# CLI: API key in `cli-settings.json` (`apiKey` / `apiKeyEnv`) and one provider resolver

**Status:** done on `feat/cli-settings-api-key` (branch 3 of 4, stacked on
`refactor/cli-settings-user-owned`)
**Related plans:** `2026-09-23_cli-settings-user-owned.md`, `2026-08-04_cli-bare-run-settings-sync.md` (decision A3)
**Touched:** `apps/cli/src/lib/utils/provider-config.ts` (new) + test, `apps/cli/src/commands/cli/run.ts`,
`apps/cli/src/types/types.ts`, `apps/cli/src/lib/storage/settings.ts` + test,
`apps/cli/src/commands/cli/__tests__/run.test.ts`, `apps/cli/README.md`

## Symptom

Even with provider, model and base URL in the settings file, a bare `tumble` against the
user's OpenAI-compatible server stopped with "No API key provided". The key was only ever
read from `--api-key`, the provider's env var (`OPENAI_API_KEY`, not set on this machine)
or the CLI's extension state, and that state's active profile is `openai-codex`, whose
key field is empty. Shell history shows the consequence: `tumble --reasoning-effort high`
followed immediately by `tumble --api-key asd --reasoning-effort high`, and every other run
carrying `--api-key 1111`.

## Decision (user)

Both forms: `apiKey` holds the key literally, `apiKeyEnv` names an environment variable
that holds it. The CLI never writes either (branch 2).

## Change

`run.ts` had three hand-written precedence chains (provider, model, base URL) plus a key
chain that ignored the provider of the source (`vsCodeConfig.apiKey` and
`vsCodeConfig.model` were used even when the extension state belonged to another
provider). They are replaced by `resolveProviderConfig` in `provider-config.ts`:

- Sources: `fallback` (the CLI's extension state), then `layers` from lowest to highest
  (settings file, flags). Branch 4 inserts the per-mode layer here.
- Provider-bound values (`model`, `baseUrl`, `apiKey`, `apiKeyEnv`) belong to the provider
  of their layer; a layer without `provider` inherits the one below. A value is used only
  while that provider is active. This is decision A3 generalised to every provider-bound
  value, and it also closes the two cross-provider leaks above.
- `reasoningEffort` is not provider-bound: the highest layer that sets it wins.
- Key order: `apiKey`, else `apiKeyEnv` (highest layer of the active provider first), then
  the provider's env var, then the fallback's key. A configured `apiKeyEnv` whose variable
  is unset is reported by name instead of silently falling through to `OPENAI_API_KEY`.

Behaviour change for an edge case: a settings `model` without a `provider` used to be
ignored; it now applies to the provider inherited from below (the extension state or the
default). A user writing only `"model"` means that model.

The file may hold a key, so the run warns (`chmod 600`) when group or others can read it.
`safeWriteJson` preserves the file mode, so the onboarding write keeps `0600`.

## Tests

- `provider-config.test.ts` (20): the four A3 cases ported from `run.test.ts`, inheritance,
  aliases, defaults, base URL scoping, reasoning effort across a provider switch, and the
  whole key order including the unset-`apiKeyEnv` report and cross-provider isolation.
- `run.test.ts`: a bare run with the user's exact settings (openai, base URL, model,
  `apiKey`, `reasoningEffort: max`) reaches the host without flags; `apiKeyEnv` is read;
  an unset `apiKeyEnv` exits 1 naming the variable.
- `settings.test.ts`: the permission check, and that a CLI rewrite keeps `0600`.
