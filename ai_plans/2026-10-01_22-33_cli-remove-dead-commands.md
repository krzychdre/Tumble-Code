# CLI: remove dead commands, the one-choice onboarding screen and dead UI state

Status: done (branch `chore/cli-remove-dead-commands`), item B4 of `ai_plans/2026-10-01_simplification-round-2.md`.

## Touched files

Deleted:

- `apps/cli/src/commands/auth/{login,logout,status}.ts`
- `apps/cli/src/lib/storage/credentials.ts` + `__tests__/credentials.test.ts`
- `apps/cli/src/lib/auth/{index,token}.ts` (token expiry helpers, only `auth status` used them)
- `apps/cli/src/lib/utils/onboarding.ts`, `apps/cli/src/ui/components/onboarding/`

Edited: `apps/cli/src/main.ts`, `commands/auth/index.ts`, `commands/cli/list.ts`, `commands/cli/run.ts`,
`lib/storage/index.ts`, `types/constants.ts`, `types/types.ts`, `ui/store.ts`, `ui/stores/uiStateStore.ts`,
`apps/cli/package.json` (`dev:local` script), tests (`argument-parser`, `flag-defaults`, `run`, `settings`,
`uiStateStore`, and four UI specs that reset the UI store), the help snapshot, `apps/cli/README.md`,
`docs/09-environment-variables.md`, `.changeset/cli-remove-dead-commands.md`.

## Problem

- `tumble auth login` opened `${AUTH_BASE_URL}/cli/sign-in` (`commands/auth/login.ts`); the self-hosted cloud has
  no `/cli` route (`self-hosted-cloudapi/src/routers/auth.py` only serves `/client/...`). The saved token was read
  only by `list.ts` (`createListHost`) as an Anthropic API key. `auth logout`/`auth status` only managed that token.
- `tumble list models` (`list.ts` `listModels`) always printed an empty `models` object.
- The first-run onboarding (`lib/utils/onboarding.ts`, `OnboardingScreen`) offered one choice ("bring your own
  key"), stored `onboardingProviderChoice` and printed how to set a key; `run.ts` assigned the result to a variable
  nobody read.
- `manualFocus`/`setManualFocus` (`uiStateStore.ts`) and `updateMessage` (`ui/store.ts`) had no caller;
  `resetUIState` was called only by tests.
- `runListAction` and `runUpgradeAction` in `main.ts` were byte-identical.

## Fix

- Commands, credentials store, token helpers, `AUTH_BASE_URL` / `ROO_AUTH_BASE_URL` and the `dev:local` script
  removed. `auth` keeps the `codex` subcommands; its description is now "Manage provider authentication".
- `list`: no token fallback; the `-k` option stays (removing it would make old scripts fail on an unknown option)
  with honest help: the key goes to the extension the listing starts and is not needed to list.
- Onboarding replaced by one line printed in the interactive session when no flag, settings file or CLI extension
  state names a provider: `[CLI] No provider configured, using openrouter. Set provider and apiKey (or apiKeyEnv)
in <settings path>, or pass --provider and --api-key.` The existing "No API key provided ..." error still
  follows when the key is missing, so the "how to configure" guidance is kept.
- `onboardingProviderChoice` left `CliSettings`. The settings file is parsed with `JSON.parse` and no schema
  (`lib/storage/settings.ts`), and the key was never in `packages/types`, so an old file that carries it still loads.
- Dead UI state removed; tests reset the UI store with zustand's `getInitialState()`.
- `runListAction`/`runUpgradeAction` merged into `runAndExit`.

## Tests

- `argument-parser.test.ts`: `auth login/logout/status` and `list models` now fail as unknown commands; help
  snapshots updated (list, auth, root help) and the obsolete `auth login --help` snapshot dropped.
- `run.test.ts`: the provider hint is printed once with no provider and not at all with a provider in the settings.
- Whole `apps/cli` suite (`--maxWorkers=2`): 107 files passed, 1 skipped.

## Notes / caveats

- `saveSettings` (`lib/storage/settings.ts`) now has no production caller (onboarding was the only writer, which
  matches the README's "only you write it"); it stays because the specs use it to write fixture files. knip does not
  flag it since specs import it.
- The hint is printed only in the interactive session, like the onboarding screen was; print mode is unchanged.
