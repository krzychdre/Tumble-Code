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
   binding to the buffer with `setCachedStateField`. `schema.spec.ts` pins the rows.
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

The largest of the three — roughly 15 files today (tracked as S4: the goal is to generate the webview side from one
descriptor). Copy the most similar existing provider and follow the compiler errors.

1. **Portable metadata** (`packages/types`): the provider entry in `provider-registry.ts` (id, name, capabilities),
   the model list under `packages/types/src/providers/`, the settings fields in `provider-settings.ts` (the flat
   `providerSettingsSchema` is on the do-not-touch list — add to it, don't restructure it), and validation in the
   provider validation registry.
2. **Handler** (`src/api`): the handler class in `src/api/providers/` implementing `createMessage` returning an
   `ApiStream`; export it from the barrel and register the factory in `src/api/runtime-provider-registry.ts`.
   If the API speaks the Chat Completions wire format, reuse `chat-completions-stream.ts` instead of writing a
   parser (API-7); otherwise write the provider's own parser and emit the chunk types from
   `src/api/transform/stream.ts`.
3. **Message conversion**: a converter in `src/api/transform/` mapping between the extension's messages and the
   provider's format (the converters are on the do-not-touch list per protocol — add a new file, don't edit the
   shared ones).
4. **Webview**: the settings form component, the entry in `provider-ui-registry.tsx`, and the model-selection
   helpers.
5. **CLI**: `apps/cli/src/lib/utils/provider-types.ts` already derives from the shared registry; add
   `keyEnvVar`/`baseUrlEnvVar` to `providerEnvMap` if the provider takes an API key and/or base URL from the
   environment (and a row in [09-environment-variables.md](09-environment-variables.md)).
6. **Tests**: request-construction and stream-parsing unit tests against recorded fixtures, the registry table spec,
   and — only for a real workflow — one e2e case under `apps/vscode-e2e/src/suite/providers/`.

## How these paths were verified

Each table above names the file that owns the step; the entry conditions (which file the compiler complains about
first) come from `TOOL_DESCRIPTORS`/`TOOL_HANDLERS` being `Record<ToolName, ...>`, `SETTINGS_SCHEMA` being keyed by
`BufferableSettingsKey`, and the provider registries being typed records. When a step moves, this page moves with it
(same-PR docs rule).
