# Level 3: adding a setting, a tool, a provider

The three most common extension changes, as file-by-file checklists. The 2026-09 refactor made each of them mostly
"add rows to typed tables and follow the compiler errors" — the tables are `Record<Name, ...>`, so a missing row fails
the build instead of failing at runtime. Details of how each mechanism works are on
[04-tools-and-providers.md](04-tools-and-providers.md) and [architecture.md](architecture.md); this page is only the
path.

## Add a setting

Settings are stored by `ContextProxy` under the keys of `GlobalSettings`; the webview's Settings view edits them in a
Save buffer (the `cachedState` rule from `AGENTS.md`: controls bind to the buffer, never to live state).

1. **Schema**: add the key to `GlobalSettings` in `packages/types/src/global-settings.ts` (Zod schema + type). This
   is the source of truth for the key name and shape.
2. **Default**: add the value to `SETTINGS_DEFAULTS` in `packages/types/src/settings-defaults.ts`. Every reader of a
   possibly-unset value writes `?? SETTINGS_DEFAULTS.yourKey`, never a literal default such as `?? true` or `|| 5`
   (D2). `SETTINGS_DEFAULTS` and `resolveSettings` are re-exported through `@roo-code/types`.
3. **Host side**: read it via the settings object `ContextProxy` returns (`getGlobalSettings` / the `Task` and
   `ClineProvider` accessors), not `globalState` directly.
4. **Settings view**: add a row to `SETTINGS_SCHEMA` in `webview-ui/src/components/settings/schema.ts` — it says when
   the change reaches the host (`onSave` via the Save button, or `immediate` via `postImmediateSetting` for things a
   running task already consults) and how Save serializes it. Then render the control in the right section component,
   binding to the buffer with `const [value, setValue] = useSetting("yourKey")` from `settings/SettingsDraftContext.tsx`
   (typed by the key, no new props on `SettingsView`). `schema.spec.ts` pins the rows.
5. **State**: if the webview needs the current value outside the Settings view, add it to the state
   `ProviderStateBuilder` (`src/core/webview/ProviderStateBuilder.ts`) posts, so it arrives as part of `ExtensionState`.
6. **Docs and changelog**: a changeset, and when the setting changes a documented mechanism, the docs page in the
   same PR. If a secret or credential is involved, it belongs in `SecretStorage` (via `ContextProxy` secrets or
   `ProviderSettingsManager`), never in `globalState` or a plain env var — see [06-persistence.md](06-persistence.md).

For an environment variable instead of (or beside) a setting, add a row to
[09-environment-variables.md](09-environment-variables.md) in the same PR.

## Add a tool

One class plus rows in typed tables; the compiler enforces the wiring.

1. **Name and types**: add the tool to `packages/types/src/tool.ts` (name, param names, display name, group) and the
   typed arguments to `NativeToolArgs` in `src/shared/tools.ts`.
2. **Schema the model sees**: write `src/core/prompts/tools/native-tools/<name>.ts` and export it from the
   `index.ts` there.
3. **Parsing**: add a parser entry in `src/core/assistant-message/toolArgParsers.ts` (partial and complete parsing).
4. **Descriptor**: add a row to `TOOL_DESCRIPTORS` (`src/core/tools/toolDescriptors.ts`) with the behaviour flags —
   `approvalCategory`, `requiresCheckpoint`, whether it counts toward context compaction, `describe`.
5. **Handler**: add the lookup row in `TOOL_HANDLERS` (`src/core/assistant-message/toolHandlers.ts`) pointing at your
   `BaseTool` subclass in `src/core/tools/`.
6. **Chat row**: add a renderer in `webview-ui/src/components/chat/rows/renderers/tool/` and register it in the
   `TOOL_RENDERERS` dispatcher (see [05-webview-ui.md](05-webview-ui.md)).
7. **Auto-approval**: pick the `approvalCategory` deliberately (`readOnly`, `write`, `execute`, `mcp`, `modeSwitch`,
   `subtask`, `subtaskFinish`, `followup`, `alwaysAllowed`, `manual`, `none`); the user's toggles map to those
   categories (`src/core/auto-approval/`).
8. **Tests**: parser spec, descriptor table spec (the compiler does most of it), handler spec with the tool result
   shape, renderer test at the webview layer. See the test-placement guidance in `AGENTS.md`.
9. **Do not touch**: the legacy `read_file` `files` shape and the tool-name aliases stay (weak models still send
   them; see [04-tools-and-providers.md](04-tools-and-providers.md)).

Custom tools (per-workspace JSON tools) and MCP tools do not need any of this: they register at runtime through the
custom-tool registry (`packages/core/src/custom-tools/`) and `McpHub` respectively.

## Add a provider

About 13 code files, most of them one row in a typed table keyed by provider id, so the compiler lists what is
missing once the id is in `providerRegistry`. Copy the most similar existing provider and follow the compiler
errors. Worked example: a provider with a static model list and an API key (Moonshot, MiniMax and xAI are shaped
like this).

1. **Portable metadata** (`packages/types/src/`), all required:
    - `providers/<id>.ts`: the model list and default model id; export it from `providers/index.ts`.
    - `provider-registry.ts`: the `providerRegistry` entry (id, lifecycle, label, display order, model source for
      fetched lists).
    - `provider-models.ts`: the `providerModelDefinitions` row (model-id field, model list, default model, unknown
      model policy).
    - `provider-validation.ts`: the API key field in `providerApiKeyFields` (it must be one of the provider's
      `providerCredentialFields`, the compiler checks it) and the required fields in `providerValidationRegistry`.
    - `provider-config/configs.ts` and `provider-config/index.ts`: the config schema (the persisted, non-secret
      fields), its entry in `providerConfigSchemas`, and the provider's credential settings keys (API key, access
      keys) in `providerCredentialFields`. Everything else about the settings schema is generated from these two
      tables: the persisted `knownProviderConfigurationSchema` arm, the legacy arm in
      `providerSettingsSchemaDiscriminated`, the flat `providerSettingsSchema` (`provider-settings.ts`) and
      `SECRET_STATE_KEYS` (`global-settings.ts`, so the credentials go to `SecretStorage`).
      `provider-schema-derivation.spec.ts` snapshots the generated schemas: review its diff and update it with `-u`.
    - `provider-model-selection.ts`: the case that resolves the configured model (a static-list provider joins the
      `resolveCatalogModel` group).
    - `provider-descriptors.ts`: the `PROVIDER_DESCRIPTORS` row (see step 4).
2. **Handler** (`src/api`): the handler class in `src/api/providers/` implementing `createMessage` returning an
   `ApiStream`; export it from the barrel and register the factory, capabilities and `resolveModel` in
   `src/api/runtime-provider-registry.ts`. If the API speaks the Chat Completions wire format, reuse
   `chat-completions-stream.ts` instead of writing a parser (API-7); otherwise write the provider's own parser and
   emit the chunk types from `src/api/transform/stream.ts`.
3. **Message conversion**: only for a new wire format, a converter in `src/api/transform/` (the converters are on
   the do-not-touch list per protocol: add a new file, do not edit the shared ones).
4. **Webview**: the `PROVIDER_DESCRIPTORS` row decides the settings form.

    - `form: { kind: "fields", fields: [...] }` when the settings fit the field kinds. `ProviderDescriptorForm`
      renders it and `provider-ui-registry.tsx` picks it up by itself: no component, no registry row. The kinds:

        - `apiKey`: label key, get-key link, optionally depending on the chosen endpoint;
        - `select`: an endpoint or API-line dropdown;
        - `url`: a labelled URL field with an optional note (Mistral's Codestral URL);
        - `checkbox`: a boolean setting with an optional note (Anthropic's 1M context beta);
        - `optionalUrl`: a "use custom base URL" checkbox revealing a URL field; `alsoClear` lists settings reset
          with the URL when it is unticked and `revealedFields` adds checkboxes under the URL (Anthropic's
          auth-token switch);
        - `modelTierSelect`: a dropdown whose options depend on the selected model: a base option that is always
          offered, plus each listed option only when the model's `tiers` name it; hidden when none is (OpenAI's
          service tier). Label, tooltip and option texts are i18n keys like every other field's;
        - `text`: a labelled text field (plain, `url` or `password` input) with an optional help text inside the
          field (LM Studio's base URL);
        - `fetchedModelPicker` (behaviour): the model picker over the provider's fetched model list. The form
          requests the list once, with the settings keys `modelSourceOptions` names, and flags a configured model
          the (non-empty) list does not contain; the picker shows the row's `service`. Requires a `modelSource` in
          `providerRegistry`, `modelSourceOptions`, `service` and `modelPicker: "in-form"` (the descriptor spec
          checks it). LM Studio's main and draft model pickers;
        - `note`: a text in the description colour, optionally with `links` (tags of the translated text rendered
          as links) and a `warningTag` (LM Studio's "Note:" label).

        Every text in a row is an i18n key (except example URLs and endpoint host names, shown as is);
        `provider-descriptors.i18n.spec.ts` in webview-ui fails when a key the table names is missing from any
        locale's `settings.json`.

        By default a field below the first one sits in its own group (`<div>`); `grouped: false` on `apiKey` and
        `optionalUrl` renders it directly in the form instead (OpenAI's base URL checkbox above the API key), and
        on `checkbox` drops the checkbox's own `<div>` (LM Studio's speculative decoding switch).

        Any field can carry `visibleWhen: { modelIdStartsWith }` or `{ modelIdIn }`, so it is shown only for some
        models; the model id is the configured one, or the provider's default when none is set (the same rule the
        request uses, `resolveProviderFormModelId`). `visibleWhen: { settingIsSet }` shows it only while another
        setting of the form is set (LM Studio's draft model picker under the speculative decoding checkbox).

    - `form: custom` when the provider needs anything else; then write the component in
      `webview-ui/src/components/settings/providers/`, export it from `index.ts` there and add its row to
      `customForms` in `provider-ui-registry.tsx` (the compiler asks for it). The form id is the provider id
      (`ProviderFormId` is derived from the table); only a component named differently needs an entry in
      `customFormIdAliases` there.
    - `service` (the model picker's "browse models" name and link) and `docsSlug` (the docs page) complete the row.
      The generic model picker, the default model set on a provider switch and the selected-model lookup in
      `useSelectedModel` read `providerModelDefinitions`, so a static-list provider needs no webview edit beyond
      the translation keys its descriptor names, added to `webview-ui/src/i18n/locales/*/settings.json`.
    - `modelPicker: "in-form"` when the provider's own form selects the model, so `ApiOptions` does not add the
      generic model picker (`PROVIDERS_WITH_CUSTOM_MODEL_UI` is derived from it); `modelSourceOptions` for a
      fetched model list names the settings keys the list request reads its base URL, API key and headers from
      (`getProviderModelSourceOptions` is derived from it).

5. **CLI**: `apps/cli/src/lib/utils/provider-types.ts` derives the provider list from the shared registry; add
   `keyEnvVar`/`baseUrlEnvVar` to `providerEnvMap` if the provider takes an API key and/or base URL from the
   environment (and a row in [09-environment-variables.md](09-environment-variables.md)).
6. **Tests**: request-construction and stream-parsing unit tests against recorded fixtures; the table specs
   (`provider-registry.spec.ts`, `provider-descriptors.spec.ts`, `provider-forms.table.spec.tsx`) cover the rows;
   and, only for a real workflow, one e2e case under `apps/vscode-e2e/src/suite/providers/`.

Still manual (not derived from one table yet): the model selection
switches in `provider-model-selection.ts` and `useSelectedModel.ts` for providers with fetched lists or special
rules (1M context tiers, Z.ai lines, DeepSeek aliases), and the translation keys in every locale.

## How these paths were verified

Each table above names the file that owns the step; the entry conditions (which file the compiler complains about
first) come from `TOOL_DESCRIPTORS`/`TOOL_HANDLERS` being `Record<ToolName, ...>`, `SETTINGS_SCHEMA` being keyed by
`BufferableSettingsKey`, and the provider registries (including `PROVIDER_DESCRIPTORS`) being typed records. When a step moves, this page moves with it
(same-PR docs rule).
