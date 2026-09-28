# D9: config migrations in dated files with a recorded done flag

Roadmap item D9 from `ai_plans/2026-09-27_simplification-roadmap.md` (section 3).
Branch: `refactor/d9-config-migrations` (off `main` @ 36e8f330b).

## Problem

Start-up migrations were written inline in two classes and grew without a
common shape:

- `ProviderSettingsManager.initialize()` ran five one-shot migrations, each
  as a private method plus a hand-written `if (!migrations.xMigrated)` block,
  and the list of flags was repeated three times (fresh-install defaults,
  "no migrations record yet" defaults, the if-chain).
- `ContextProxy` carried about 180 lines of legacy migrations as private
  methods called in a fixed order from `initialize()`.

Nothing showed how old each migration was, so none could ever be retired.

## Decision

`src/core/config/migrations/`:

| File                                     | Role                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `runner.ts`                              | `runFlaggedMigrations`, `runStartupMigrations`, `flagRecord`, the types |
| `provider-profiles/registry.ts`          | `PROVIDER_PROFILE_MIGRATIONS`, execution order                          |
| `provider-profiles/types.ts`             | migration context (`globalState.get`), `isOpaqueProfile`                |
| `provider-profiles/YYYY-MM-DD-<what>.ts` | one migration each, body moved verbatim                                 |
| `context-proxy/registry.ts`              | `CONTEXT_PROXY_MIGRATIONS`, execution order                             |
| `context-proxy/types.ts`                 | migration context (both VS Code stores plus ContextProxy's two caches)  |
| `context-proxy/YYYY-MM-DD-<what>.ts`     | one migration each, body moved verbatim                                 |

### Done record: reuse, do not invent

- **Provider profiles** already persist a done record: the `migrations`
  object inside the stored envelope (`providerProfileMigrationsSchema` in
  `@roo-code/types`, strict, one boolean per migration). The runner reads and
  sets exactly those flags; the fresh-install record (all `true`) and the
  "record missing" record (all `false`) are now built from the registry with
  `flagRecord()`, so the flag list exists once in code (plus the schema,
  which a registry spec keeps in step, in order).
- **ContextProxy** migrations get no new flag. Each already detects its own
  legacy key and removes it, so "the legacy key is absent" is the done record,
  and they run as cheap no-ops afterwards. A persisted flag would change
  behavior: `resetAllState()` clears every global state key and re-runs
  `initialize()`, and `auto-memory-defaults` must re-apply the memory defaults
  after that reset and repair an invalid memory folder on every start. A new
  global state key would also escape `resetAllState()` (it clears only
  `GLOBAL_STATE_KEYS`).

### Crash safety

Provider-profile migrations mutate the in-memory envelope; the flags and the
migrated data go to storage in one `store()` call. If that write fails,
neither lands and the next start runs the same migrations again. Every
migration is idempotent (`??=` or `=== undefined` guards, "move then clear the
old key", deleting absent keys is a no-op). A migration that throws stops the
runner before its flag is set (only `claude-code-legacy-settings` can throw;
the others keep their original internal try/catch and log).

ContextProxy migrations write key by key; a failed clean-up write leaves the
legacy key in place, and the next start repeats the move (the new location
already holds the value, so nothing is overwritten).

## Behavior

No behavior change. Bodies, log texts, execution order, and the number of
storage reads and writes are unchanged (the existing `ContextProxy.spec.ts`
pins the exact count of `globalState.get` calls and still passes).

## Tests

Commit 1 (passes on main unchanged):
`src/core/config/__tests__/configMigrations.characterization.spec.ts`, 19
tests with an in-memory fake of `globalState` and `secrets` that keeps writes,
so a second start sees the first one's result:

- flat pre-v2 profiles with no migrations record: all five run, flags
  recorded, inline secrets seeded into `provider_profile_secrets_v2`
  (snapshot of the whole envelope and the secret map)
- each flag pending alone (5 cases): only that migration changes data
- second start writes nothing (provider profiles and ContextProxy)
- v2 envelope with the migrations record removed ends at the same result
- mid-crash: the `api_config` write fails, then the next start reaches the
  same envelope and secrets as an uninterrupted start
- idempotency: migrated data with every flag reset to `false` (and a different
  global `rateLimitSeconds`) comes back identical
- ContextProxy: every legacy key at once (snapshot), legacy prompt move then
  v1-default cleanup order, explicit user memory choices kept, new locations
  never overwritten, failed clean-up writes followed by a clean start

Commit 2: `src/core/config/migrations/__tests__/runner.spec.ts`, 7 tests
(order, skip done, stop at a throwing migration without setting its flag,
registry flags equal the schema keys in order, date format, unique ids).

## Inventory: deletion candidates (NOT deleted here)

Dates are the first commit containing the migration (`git log -S`). The
deletion policy needs a release note first ("settings older than version X
are no longer upgraded"), so this PR only lists them.

| Migration (file)                                         | Introduced | Commit / PR        | Candidate?                                                                   |
| -------------------------------------------------------- | ---------- | ------------------ | ---------------------------------------------------------------------------- |
| provider-profiles/2025-04-07-rate-limit-seconds          | 2025-04-07 | 260fc3004 / #2376  | yes                                                                          |
| provider-profiles/2025-05-01-openai-headers              | 2025-05-01 | a356d7066 / #3056  | yes (then drop `openAiHostHeader` from the schema)                           |
| provider-profiles/2025-07-15-consecutive-mistake-limit   | 2025-07-15 | 93f88b45b / #5752  | yes                                                                          |
| provider-profiles/2025-07-21-todo-list-enabled           | 2025-07-21 | b1bc085aa / #6032  | yes                                                                          |
| provider-profiles/2025-12-17-claude-code-legacy-settings | 2025-12-17 | 0b86796b8 / #10077 | yes                                                                          |
| context-proxy/2025-08-29-image-generation-settings       | 2025-08-29 | c3d84d295 / #7536  | yes                                                                          |
| context-proxy/2025-12-05-invalid-api-provider            | 2025-12-05 | 9f4dcfc0e / #9869  | no: read-time `sanitizeProviderValues` also covers it, but it cleans storage |
| context-proxy/2026-01-21-legacy-condensing-prompt        | 2026-01-21 | 3f332d8e2 / #10881 | yes (then drop `customCondensingPrompt` from the schema)                     |
| context-proxy/2026-01-23-old-default-condensing-prompt   | 2026-01-23 | b042866ee / #10931 | yes                                                                          |
| context-proxy/2026-07-13-auto-memory-defaults            | 2026-07-13 | 359ea2407 / #118   | no: re-applies defaults after reset, repairs a bad folder every start        |
| context-proxy/2026-09-25-global-state-secrets            | 2026-09-25 | 1af172cf2 / #420   | not yet (3 days old)                                                         |

Deleting a provider-profile migration: remove the file and its registry entry,
and keep its flag in `providerProfileMigrationsSchema` (the schema is strict,
so stored envelopes that carry the flag must still parse); the registry spec
then needs a "retired flags" allowance.

### Related start-up normalizations left in place (not one-shot)

These stay in `ProviderSettingsManager.initialize()` because they are
invariants checked on every start, not one-shot migrations:

- seed `modeApiConfigs` when missing (2025-05-05, 01fec4c1d / #3071)
- give every profile an id (2025-03-26, a414c7d02 / #1997)
- `MODEL_MIGRATIONS` model-id renames (2025-09-26, 8a7d90e43 / #8330): the
  table is empty, so this loop does nothing today. Candidate for deletion
  together with the table.
- pre-v2 flat envelope to v2 (`migrateProviderProfiles` in
  `@roo-code/types`) and seeding inline secrets into
  `provider_profile_secrets_v2` (`extractRawFlatApiConfigs`, 2026-07-19,
  6792f2a0b / #126). Schema-version migration keyed on `schemaVersion`, owned
  by the types package; out of scope.

### Also noted, not moved

- `readApiMessages` (`src/core/task-persistence/apiMessages.ts`) still reads
  a Cline-era `claude_messages.json` when `api_conversation_history.json` is
  missing (first seen 2024-08-17, d1437e6d2; renamed 2024-09-29, 9e01aaa3d).
  It deletes the old file after a successful parse and returns the messages
  without writing the new file itself, so the history only survives if the
  caller saves it afterwards. Per-task file migration, not a config one; left
  in place. Candidate for deletion with the others after a release note.
- `TaskHistoryGateway`'s legacy `taskHistory` global state to per-task files
  migration has its own marker and cleanup (`clearLegacyTaskHistoryKeys`);
  out of scope.
- `ContextProxy.sanitizeProviderValues` strips `claudeCodePath` /
  `claudeCodeMaxOutputTokens` at read time; a read filter, not a migration.
