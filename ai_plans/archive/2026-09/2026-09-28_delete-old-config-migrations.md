# Delete the old one-time config migrations

Date: 2026-09-28. Branch: `chore/delete-old-config-migrations` (off `main` @ 996fd30db).

## Decision

Owner decision (2026-09-28): delete the old start-up config migrations that
`ai_plans/2026-09-28_d9-config-migrations.md` listed as deletion candidates,
and the Cline-era `claude_messages.json` read path noted there. No separate
release note is needed; the changeset says it in one sentence.

## What is deleted

The eight migrations marked "yes" in the D9 inventory table:

| Migration file                                           | Introduced |
| -------------------------------------------------------- | ---------- |
| provider-profiles/2025-04-07-rate-limit-seconds          | 2025-04-07 |
| provider-profiles/2025-05-01-openai-headers              | 2025-05-01 |
| provider-profiles/2025-07-15-consecutive-mistake-limit   | 2025-07-15 |
| provider-profiles/2025-07-21-todo-list-enabled           | 2025-07-21 |
| provider-profiles/2025-12-17-claude-code-legacy-settings | 2025-12-17 |
| context-proxy/2025-08-29-image-generation-settings       | 2025-08-29 |
| context-proxy/2026-01-21-legacy-condensing-prompt        | 2026-01-21 |
| context-proxy/2026-01-23-old-default-condensing-prompt   | 2026-01-23 |

The ninth item is the `claude_messages.json` fallback in
`src/core/task-persistence/apiMessages.ts`: `LEGACY_API_MESSAGES_FILE`,
`readLegacyApiMessages`, `migrateLegacyApiMessages` and the second
"new file appeared meanwhile" check, exactly the list in
`ai_plans/2026-09-28_legacy-claude-messages-migration-loss.md`.

Kept: `invalid-api-provider`, `auto-memory-defaults`, `global-state-secrets`
(reasons in the D9 table), the runner, and both registries (the provider
profile one is now empty).

## Retired flags

`providerProfileMigrationsSchema` in `@roo-code/types` is strict, so the five
provider-profile flags stay in it as optional keys: every existing install
stores them. They are listed in `RETIRED_PROVIDER_PROFILE_MIGRATION_FLAGS`
(`provider-profiles/registry.ts`) with one line each on what the migration
did. The registry spec now checks that the schema keys are exactly the
retired flags followed by the live registry flags, that no live migration
reuses a retired flag (an install that recorded the flag as done would skip
the new migration), and that a record with every retired flag still parses.

A stored envelope without a `migrations` record now gets `migrations: {}`
written once (the record built from the empty registry).

## Why dropping them is safe for current installs

Every reader already defaults the per-profile values the migrations used to
fill in: `rateLimitSeconds || 0` (RetryHandler, ApiOptions),
`todoListEnabled ?? true` / `!== false` (build-tools, system prompt input,
filter-tools-for-mode, environment details), `consecutiveMistakeLimit ??
DEFAULT_CONSECUTIVE_MISTAKE_LIMIT` (Task). Profiles that were never migrated
only lose values carried over from very old versions (the global rate limit,
the OpenAI Host header, a nested image-generation key, a pre-2026-01 custom
condensing prompt).

## Not changed

- Schema keys that only the deleted migrations used (`openAiHostHeader` in
  the OpenAI provider config, `customCondensingPrompt` in global settings)
  stay: the provider config schema is strict, and `customCondensingPrompt`
  is also a field of the webview state and the condense API.
- The start-up normalizations listed in D9 (mode map seed, profile ids,
  `MODEL_MIGRATIONS`, pre-v2 envelope upgrade with secret seeding).

## Tests

Commit 1 (fails on main, 11 tests): new expectations in
`runner.spec.ts`, `configMigrations.characterization.spec.ts` (snapshots
replaced by explicit values; covers "stored envelope with every retired flag,
true or false, still loads and is not rewritten" and "retired ContextProxy
keys left as stored"), `ProviderSettingsManager.spec.ts`,
`ContextProxy.spec.ts`, `apiMessages.spec.ts`. Tests that only covered the
deleted migrations are removed.

Commit 2: the deletion, plus a second `globalState.get` count assertion in
`ContextProxy.spec.ts` that commit 1 missed.
