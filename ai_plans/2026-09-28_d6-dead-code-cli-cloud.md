# D6: Remove dead code (CLI, cloud API, scripts)

Roadmap item: `ai_plans/2026-09-27_simplification-roadmap.md`, Priority 2, D6.
Branch: `chore/d6-dead-code` (off `main` @ `6f1e86c9f`).

## What the roadmap listed, and what was still there

The roadmap was written on an older main. Each item was re-checked with `git grep` on `6f1e86c9f`:

| Item                                                                                                                              | State on main                                  | Action                        |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| webview `ui/select-dropdown.tsx`, `SlashCommandItemSimple.tsx`, `BatchListFilesPermission.tsx`, `utils/provider-profile-draft.ts` | already deleted by `fc62c1fee` (PR #541, "D6") | none                          |
| CLI `lib/sdk/client.ts` (tRPC client)                                                                                             | present, `createClient` never called           | deleted (whole `lib/sdk`)     |
| CLI `SDK_BASE_URL` / `ROO_SDK_BASE_URL`                                                                                           | present, no reader                             | deleted                       |
| CLI deps `@trpc/client`, `superjson`                                                                                              | only imported by `lib/sdk/client.ts`           | removed, lockfile regenerated |
| cloud `bench_new.py`, `verify_summary.py`                                                                                         | 0-byte files                                   | deleted                       |
| cloud `ProviderConfig` model                                                                                                      | only `Organization.provider_config` named it   | model deleted, table kept     |
| cloud `routers/web.py` shim                                                                                                       | re-exports only, imported only by tests        | deleted, tests repointed      |
| cloud `get_current_user_optional`                                                                                                 | only tests called it                           | deleted with its assertions   |
| `scripts/add-missing-translations.js`                                                                                             | one-shot (#145), referenced by nothing         | deleted                       |

## Evidence and details

### CLI `lib/sdk`

`lib/sdk/index.ts` re-exported `client.ts` and `types.ts`. The only import in production code was
`import type { User } from "@/lib/sdk/index.js"` in `agent/extension-host.ts`, for
`ExtensionHostOptions.user`. Every construction site (`commands/cli/run.ts`, `commands/cli/list.ts`
and four specs) passed `user: null`, and the only reader, `ui/App.tsx`, forwarded it to
`WelcomeBanner`, whose `Welcome back, {name}` line could therefore never render. The option, the
banner prop and that line went with the module. `ROO_SDK_BASE_URL` is removed from the `dev:local`
script, the CLI README and `docs/09-environment-variables.md`.

`pnpm install` removed exactly `@trpc/client`, `@trpc/server`, `superjson`, `copy-anything` and
`is-what` from `pnpm-lock.yaml` (48 lines).

### Cloud `provider_configs`: model removed, data kept

The schema is built by `create_all` on a FRESH database and evolved by migrations on existing ones
(`src/db_bootstrap.py`). Removing the model means a FRESH database no longer gets the table. No
migration drops it, so existing deployments keep any rows. Without further work the drift test
(`tests/test_migration_drift.py`) would report the table as drift and `alembic revision
--autogenerate` would propose a `DROP TABLE`. To prevent both, `src/models/__init__.py` now declares
`RETIRED_TABLES = {"provider_configs"}` and an `include_name` hook; `alembic/env.py` and the drift
check pass it to alembic, so retired tables are left out of every comparison.

The ORM cascade `Organization.provider_config` (`delete-orphan`) is gone too. The app never deletes
an organization, and the table's foreign key has `ON DELETE CASCADE` in the database anyway.

Migration `b2c3d4e5f6a7` still alters `provider_configs`; it only runs on LEGACY databases, which
have the table (FRESH ones are stamped to head without running migrations).

### Cloud `routers/web.py`

A re-export shim left after the CAPI-M5 split. The six test modules that imported it now import from
`src/web/presenters/*`, `src/services/quality_overview.py` and `src/routers/web_tasks.py` directly;
`test_the_old_import_path_re_exports_the_moved_helpers` is dropped with the shim.

## knip `exports` / `types` rules: left at `warn`

The roadmap asked to raise them to `error`. On this branch `pnpm knip` still reports 36 files with
unused exports (141 symbols) and 29 files with unused exported types (116 symbols), all pre-existing
(CLI barrels, `src/core/memory/index.ts`, `packages/vscode-shim` types, webview UI kit exports).
Raising the rules would make `pnpm knip` (and CI) fail, so they stay at `warn`; cleaning those is a
separate item.

## Verification

- Commit 1 (tests only): the new `test_retired_tables_are_kept_in_the_database_but_have_no_model`
  fails with `ImportError: cannot import name 'RETIRED_TABLES'`; the repointed tests pass on main
  code (241 passed).
- Cloud API: full pytest suite, 836 passed, 1 xfailed.
- CLI: `tsc --noEmit` clean; touched specs (`extension-host`, `App.characterization`,
  `useExtensionHost`, `transcript`) 117 passed; eslint clean on touched files.
- `pnpm knip` exits 0.
