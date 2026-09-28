# S4 clean-up, slice c: generate the provider settings schema arms and SECRET_STATE_KEYS

Continues the S4 provider descriptor work (`ai_plans/2026-09-28_s4-provider-descriptor.md` and slices 2 and 3).
All three slices listed as a residual: "The settings-schema arms (`provider-config`, `provider-settings`,
`SECRET_STATE_KEYS`) are the largest remaining manual part and touch the do-not-touch flat schema; a separate,
careful item." This is that item. Branch `refactor/s4-schema-arms`, from main 2252b1657 (after slice a, #621).

## 1. Problem

Adding a provider meant, besides its config schema, four hand-written list entries in three files:

| File                       | Hand-written entry                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `provider-config/index.ts` | `knownProviderConfigurationSchema` arm (`providerId` literal + config)             |
| `provider-settings.ts`     | legacy arm `legacyProviderArm(config, credentials)` with the credential fields     |
| `provider-settings.ts`     | `.merge({ apiProvider: literal })` member of `providerSettingsSchemaDiscriminated` |
| `provider-settings.ts`     | `...arm.shape` spread in the flat `providerSettingsSchema`                         |
| `global-settings.ts`       | the credentials in `SECRET_STATE_KEYS`                                             |

All of them restate two facts per provider: its config schema (`providerConfigSchemas`, already a typed record) and
its credential keys (written twice: in the legacy arm and in `SECRET_STATE_KEYS`; a third copy lived in
`provider-settings-arms.spec.ts` as `CREDENTIAL_FIELDS`). Forgetting the `SECRET_STATE_KEYS` entry is a silent
security bug (the API key would be stored in plain global state).

## 2. Approach

Where the facts live: the credential keys cannot go into `PROVIDER_DESCRIPTORS`, because the descriptor types
are built on `ProviderSettings`, which is inferred from the schemas being generated (a type cycle). They go next
to `providerConfigSchemas` instead, as a second typed record:

- `providerCredentialFields` (`provider-config/index.ts`): `{ [K in KnownProviderId]: readonly string[] }`,
  `as const`, same order as `providerConfigSchemas`. A provider missing from it does not compile.
- Compile-time guard in the same file: a credential key must not also be a persisted config field of that
  provider (it would be written to the plain profile too).
- `providerApiKeyFields` (`provider-validation.ts`) is now typed so its value must be one of the provider's
  `providerCredentialFields` (or null); an API key field that would not reach the secret store no longer compiles.

Generated from the two tables, in `providerConfigSchemas` key order (the order every hand-written list used):

- `knownProviderConfigurationSchema`: one `{ providerId: literal, config }` arm per provider.
- `providerSettingsSchemaDiscriminated`: per provider an object of the base shape, the config shape, the
  credentials and the `apiProvider` literal, in that key order (the order the former
  `extend(config).extend(credentials).merge(apiProvider)` chain produced), then the unchanged
  `apiProvider: undefined` arm.
- `providerSettingsSchema` (the flat schema): `apiProvider`, then `Object.assign({}, ...arm shapes)`, then the
  codebase-index shape. Spreading the arms into one object keeps each key at its first occurrence and the last
  schema for it, exactly like the former literal list of spreads. Its type is the intersection of the arm shapes
  (`UnionToIntersection`); a field shared by several providers (`apiModelId`) has the same schema everywhere.
- `SECRET_STATE_KEYS`: every `providerCredentialFields` key once, then the codebase-index keys (now a named
  `CODEBASE_INDEX_SECRET_KEYS` list, as they belong to no provider). Its element type is unchanged; it is now
  a `readonly` array instead of a tuple (no consumer indexes it positionally).

## 3. Equivalence evidence

Commit 1 (characterization, green on main before any change): `provider-schema-derivation.spec.ts` snapshots

- `PROVIDER_SETTINGS_KEYS` (the flat schema's keys, in order) and `GLOBAL_STATE_KEYS` (in order),
- the JSON Schema of the flat schema, of the discriminated legacy arms and of the persisted configuration union,
  property order included (the pre-existing flat-schema snapshot in `provider-settings-arms.spec.ts` sorts keys),
- the sorted `SECRET_STATE_KEYS`, plus: no duplicates, and `isSecretStateKey` picks exactly those keys among the
  provider settings.

Commit 2 (the generation): all 6 snapshots pass unchanged (no snapshot written or updated), as do the 41 spec
files of packages/types (662 tests) and the 269 tests under `src/core/config/__tests__/` (ContextProxy,
ProviderSettingsManager).

Types: a temporary file (not committed) kept the old `provider-settings.ts` and the old configuration union
beside the new ones and asserted exact type equality (`Equals<A, B>` with the conditional-type trick) for
`ProviderSettings`, the flat schema's input type, both inferred and input types of the discriminated union,
`ProviderSettingsWithId`, the discriminated-with-id schema, the `PROVIDER_SETTINGS_KEYS` element type,
`KnownProviderConfiguration`, the configuration union, `NarrowedProviderSettings`, the `SECRET_STATE_KEYS` element
type and the keys of `SecretState`. All held; a deliberately wrong assertion failed, so the check has teeth. Then
`tsc` passed for packages/types, src, webview-ui, apps/cli, packages/cloud and packages/core.

The only runtime difference is the order of `SECRET_STATE_KEYS` (`zaiApiKey` now comes with the other provider
keys, the AWS keys follow the Bedrock row, DeepSeek and Mistral swap). Traced every reader: `Promise.all` over
reads, deletes and stores in `ContextProxy` and the strip loops in `ProviderSettingsManager` and
`provider-profile.ts` visit each key independently; `ContextProxy.getAllSecretState` builds an object whose key
order follows the list, but its only consumer `getValues()` feeds `providerSettingsSchema.parse` /
`globalSettingsExportSchema.parse` (zod output follows the schema's order), the fallback reduce over
`PROVIDER_SETTINGS_KEYS`, named-key reads (`ProviderStateBuilder`, `ClineProvider`) or a secret-filtering copy
(`extension/api.ts`); `ProviderSettingsManager.updateProfileSecrets` inserts new keys into the stored per-profile
secret object in list order, and that object is only read by key. So the order is not observable.

## 4. Adding a provider after this slice

The settings schema part is two rows in `provider-config/` (`configs.ts` schema + `providerConfigSchemas` row, and
the `providerCredentialFields` row in `index.ts`); `provider-settings.ts` and `global-settings.ts` are no longer
touched. The derivation spec's snapshots change (review, then `-u`). `docs/10-adding-things.md` now says so, and
the do-not-touch entry in `docs/architecture.md` notes that the flat schema is generated and which spec pins it.
A static-list API-key provider now touches about 13 code files (was 15).

## 5. Residuals

- `providerApiKeyFields` cannot be derived from `providerCredentialFields`: Vertex has one credential
  (`vertexJsonCredentials`) but no "API key" in the UI and validation sense, Bedrock has four. It is now checked
  against it instead.
- The codebase-index secret keys stay a hand-written list (they belong to the code-index settings, not to a
  provider).
- `baseProviderSettingsSchema` and `sharedProfileSettingsSchema` still repeat the shared profile fields (pinned by
  existing specs); unrelated to adding a provider.
