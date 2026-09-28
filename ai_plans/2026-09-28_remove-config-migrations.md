# Remove the remaining config migrations (provider profiles and global state)

Date: 2026-09-28. Branch: `refactor/remove-config-migrations` (off `main` @ 17a976ff6).

## Why

Owner report: creating a provider profile "breaks the whole configuration";
OpenAI Compatible profiles lose their model and the settings fall back to
defaults.

Evidence (the owner's real stored profiles, decrypted read-only): 5 of 7
profiles were stored as `{ provider: { providerId: "unknown",
opaqueLegacyPayload: <an intact v2 profile> } }`. The extension log shows
`Provider 'unknown' is unavailable and cannot be activated` on every mode
switch to them (code, ask, debug and reviewer were bound to one of them).

Root cause: `importSettingsFromPath` merged the local profiles, already in the
v2 shape (from `export()`), with the imported ones converted to the flat shape,
and passed that record without a `schemaVersion` to
`ProviderSettingsManager.import()`. `migrateProviderProfiles` read it as a v0
record and ran every profile through the v1 -> v2 flat migration. A v2 profile
has no `apiProvider`, so each local profile became an opaque "unknown"
provider. `export()` also wrote no `schemaVersion`, so importing one's own
export destroyed every profile the same way.

## Owner decisions (2026-09-28)

1. Remove the config migrations from the code, both the provider-profile ones
   and the ContextProxy (global state) ones.
2. Data without the v2 envelope (an old stored record or an old import file)
   gives a readable error; stored data is never overwritten in that case.
3. The owner's own profiles are not recovered: they start from an empty
   configuration and recreate the profiles by hand.

## What is removed

`packages/types/src/provider-profile.ts`:

- the v0 -> v1 -> v2 chain (`migrateProviderProfiles`,
  `migrateProviderProfilesV1ToV2`, the legacy flat record schemas and types);
- `extractLegacyInlineSecrets` (first-run seeding of inline API keys);
- `providerProfileMigrationsSchema` and the `migrations` done-record field.

`src/core/config/ProviderSettingsManager.ts`:

- first-run secret seeding (`extractRawFlatApiConfigs`, `readRawEnvelope`);
- `MODEL_MIGRATIONS` / `applyModelMigrations` (empty map);
- the `modeApiConfigs` seeding for old installs, the "ensure every profile has
  an id" pass, the flagged-migration run and the "rewrite an unversioned
  record" store;
- the inline-secret seeding in `import()`.

`src/core/config/migrations/` entirely: the runner, both registries and the
three ContextProxy migrations:

- `global-state-secrets` (moved a plain `vertexJsonCredentials` copy into
  secret storage): pure migration.
- `invalid-api-provider`: `ContextProxy.getProviderSettings()` already clears
  an unknown provider at read time.
- `auto-memory-defaults`: every reader already defaults the values it wrote
  (`isAutoMemoryEnabled` -> true, `memoryRecallEnabled ?? true`,
  `autoDreamEnabled ?? true`, `autoDreamMinHours ?? 24`,
  `autoDreamMinSessions ?? 5`, the settings view schema defaults). Its other
  job, clearing a stored `autoMemoryDirectory` that no longer validates, moves
  to `getMemoryBaseDir()`: an invalid override falls back to the default
  folder with a warning instead of throwing.

## What stays (translation, not migration)

The running extension works on flat `ProviderSettings`; the store holds v2
profiles. The per-profile flat -> v2 conversion used by every save
(`migrateLegacyFlatProviderProfile`, renamed `toPersistedProviderProfile`) and
`providerProfileToLegacySettings` stay. `store()` keeps converting a flat
profile per profile (tests and `import()` callers may pass either shape).

## New behaviour

- `parseProviderProfilesEnvelope(input)` accepts only
  `{ schemaVersion: 2, data }`; anything else throws
  `UnsupportedProviderProfilesVersionError` with a message that says what to do.
- `ProviderSettingsManager.load()` uses it; a store without the envelope makes
  every profile call fail with that message and is never overwritten.
- `export()` returns the v2 envelope, so the export file carries
  `schemaVersion: 2`.
- Import requires the v2 envelope in the file. Imported profiles are merged
  with the local ones as persisted profiles (no flat round trip). A local
  profile with the same name keeps its local id, so its stored secrets stay
  attached; mode bindings to the imported id are remapped to it.
- Files exported before this change have no `schemaVersion` and are rejected
  with the readable error (owner decision 2).

## Tests

- types: the envelope parser (accepts v2, rejects missing and other versions),
  the flat -> v2 translation.
- importExport: a local profile the file does not replace keeps its provider
  and model after import; an export imports back with every profile usable; an
  unversioned file is rejected and nothing is written.
- ProviderSettingsManager: an unversioned store is not overwritten.
- memory paths: an invalid stored folder falls back to the default folder.
- Deleted: the runner spec, the migration characterization spec and the
  migration cases in the ContextProxy, ProviderSettingsManager and profile
  specs.

## Added during review

- The import took the local profiles from `export()`, which drops
  `modelMaxTokens` / `modelMaxThinkingTokens` for models that do not use them,
  and stored that filtered view back: importing any file erased those fields in
  local profiles the file did not touch (older than this change). The import now
  reads the stored profiles as they are (`ProviderSettingsManager.readProfiles()`).
  Test: "keeps the token fields of a local profile the file does not replace"
  (fails with the `export()` read).
- `load()` reported a schema error to telemetry through
  `TelemetryService.instance` even when telemetry was not started; that threw
  "TelemetryService not initialized" and hid the real error. Guarded with
  `hasInstance()`.
- Way out for a store in an old format: every profile call fails, including
  saves, but Settings > About > Reset (`resetAllConfigs`) deletes the store
  without reading it. The error message names it.

## Verification

- The regression test "keeps a local OpenAI Compatible profile the file does
  not replace usable" fails on `main` (a throwaway worktree with its own
  `node_modules`, so `@roo-code/types` resolved to the old code): the local
  profile came back without `apiProvider`.
- `tsc` clean in src, packages/types and apps/cli; config + memory specs
  449/449; types specs pass; eslint clean; knip reports only the two local,
  git-ignored zoo-port scripts.

## Known, not changed here

- One malformed profile inside a v2 file fails the whole import (before, a
  profile with a bad field was skipped). Files come from `exportSettings`, so
  this is accepted.
- The local id is kept only for a same-name profile; an imported profile with a
  different name but the id of another local profile would share its secrets.
- A same-name profile imported with a different provider keeps the old
  provider's secrets attached (unused, harmless).
- `apps/cli/src/lib/utils/vscode-config.ts` still reads a legacy flat profile
  store as a read-only fallback for its own defaults; it converts and writes
  nothing, so it is not a migration and stays.

## Owner's data

After the build is installed: with VS Code closed, delete the Tumble Code
`roo_cline_config_api_config` secret (the profile store) so the extension
starts from the default profile. A read-only decrypted copy was taken to
`/tmp/tumble_profiles.json` during the investigation (mode 600).
