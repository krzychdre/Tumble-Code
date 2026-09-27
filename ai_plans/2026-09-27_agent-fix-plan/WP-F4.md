# WP-F4: Docs pages for configuration (environment variables) and how-to recipes

Status: ready
Effort: S      Risk: low      Depends on: none (docs only; re-run the claims check of section 7 if other WPs merged first)
Branch name: fix/f4-configuration-and-how-to-docs      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

Add two pages under `docs/`: `docs/09-configuration.md`, one table of every environment variable the extension,
the CLI, the cloud client and the self-hosted cloud API read (who reads it, default, purpose, dead or live), plus
the `tumble-code.*` VS Code settings; and `docs/10-how-to.md`, step-by-step recipes with exact file lists for
adding a setting, a native tool, a provider and a webview-to-host message. Link both from `docs/README.md`, fix two
stale sentences found on the way (`docs/04-tools-and-providers.md`, `docs/architecture.md`), and record F4 as done
(and the dead variables as a new finding F5) in the roadmap. The full page text is in section 6, ready to paste.

## 2. Why it matters (user-visible effect, 2-4 sentences)

Contributors (people and agents) currently have to grep five packages to learn which variable points the extension
at a self-hosted cloud, and they add a tool or provider by trial and error against the compiler. The pages answer
both in one place and name the specs that pin each list, so a change is complete the first time. The table also
exposes configuration that does nothing today (for example the CLI's `*_BASE_URL` variables that
`apps/cli/README.md` promises), so users stop setting them.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `AGENTS.md`, `docs/README.md` (section "How these pages are written": files and symbols, no line numbers; what
  the code does today, plans go to `ai_plans/`).
- `docs/architecture.md`: "The CLI runtime contract", "Where settings defaults live today", "From the webview to
  a handler", the `src/eslint.config.mjs` bullet under "Allowed dependency directions".
- `docs/04-tools-and-providers.md`: the table under "## Tools", section "### Adding a provider today".
- `ai_plans/2026-09-27_simplification-roadmap.md`: the "## Status" table (row `R5`) and the "New findings" table
  (row `F4`), item `D15`.
- Evidence for the "dead" rows (read only): `packages/cloud/src/config.ts` (`getRooCodeProviderUrl`),
  `apps/cli/src/types/constants.ts` (`SDK_BASE_URL`), `apps/cli/src/lib/utils/provider-types.ts`
  (`getBaseUrlFromEnv`), `self-hosted-cloudapi/config/settings.py` (`authentik_app_slug`),
  `self-hosted-cloudapi/docker-compose.yml` (`BRIDGE_ENABLED`).

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`docs/README.md`, index table, last row (near line 15):

```markdown
| 3     | [Persistence](06-persistence.md)                 | Where settings, secrets, tasks and history live, and how writes stay atomic.          |
```

`docs/04-tools-and-providers.md`, "## Tools" table (near line 13) - the path is wrong, the file is
`src/core/tools/toolArgParsers.ts` (`ls src/core/assistant-message/toolArgParsers.ts` fails):

```markdown
| Argument parsing (partial and complete)                                | `src/core/assistant-message/toolArgParsers.ts`                 |
```

`docs/04-tools-and-providers.md`, "### Adding a provider today" (near line 68):

```markdown
Roughly 15 files: the settings schema, model list, validation and registry entry in `packages/types`; the handler,
barrel export and runtime registry entry in `src/api`; the settings form, `provider-ui-registry.tsx` and model
selection helpers in `webview-ui`. Copy the most similar existing provider and follow the compiler errors.
```

`docs/architecture.md`, "Allowed dependency directions" (near line 68) - neither file exists in `src/shared`, and
`src/eslint.config.mjs` (block `files: ["shared/**/*.ts"]`) has no exception list:

```markdown
- `src/eslint.config.mjs` forbids importing `vscode` in `src/shared`, because the webview bundles that folder and
  has no `vscode` module. The only exceptions are `shared/cloud-urls.ts` and `shared/vsCodeSelectorUtils.ts`.
```

`packages/cloud/src/config.ts`, `getRooCodeProviderUrl` (no non-test caller anywhere):

```ts
export const getRooCodeProviderUrl = () =>
	runtimeRooCodeProviderUrl || process.env.ROO_CODE_PROVIDER_URL || PRODUCTION_ROO_CODE_PROVIDER_URL
```

`apps/cli/src/types/constants.ts` (`SDK_BASE_URL` has no reader; `AUTH_BASE_URL` is used by `commands/auth/login.ts`):

```ts
export const AUTH_BASE_URL = process.env.ROO_AUTH_BASE_URL ?? "http://localhost:3000"

export const SDK_BASE_URL = process.env.ROO_SDK_BASE_URL ?? "http://localhost:3001"
```

`apps/cli/src/lib/utils/provider-types.ts`, `getBaseUrlFromEnv` (only re-exported by `provider.ts`, never called):

```ts
export function getBaseUrlFromEnv(provider: SupportedProvider): string | undefined {
	const envVar = getBaseUrlEnvVarName(provider)
	if (!envVar) return undefined
	return process.env[envVar]
}
```

`self-hosted-cloudapi/config/settings.py`, `Settings` (no reader of `authentik_app_slug`; `bridge_enabled` defaults
to `True`):

```python
    authentik_app_slug: str = Field("tumble-code", description="Authentik application slug for app-specific endpoints")
```

`self-hosted-cloudapi/docker-compose.yml`, `services.api.environment`:

```yaml
      BRIDGE_ENABLED: ${BRIDGE_ENABLED:-false}
```

`src/core/webview/messageHandlers/__tests__/registry.spec.ts` and
`src/core/webview/__tests__/webviewMessageHandler.routing.spec.ts` (the how-to page quotes these counts):

```ts
		expect(entries).toHaveLength(138)
```

```ts
		expect(ROUTED_TYPES).toHaveLength(138)
```

## 5. Root cause / analysis

VERIFIED (read or ran, 2026-09-27, at `aa173b9`):

- Environment reads were collected with
  `grep -rnoE "process\.env(\.[A-Z_a-z0-9]+|\[[^]]+\])" src apps/cli packages webview-ui/src --include=*.ts --include=*.tsx --include=*.mjs`
  (tests, mocks and `dist` excluded), plus the indirect readers `readCliRuntimeEnv(process.env)`,
  `resolveCloudEnvironment()`, `getUtf8LocaleEnv`, `injectVariables(..., { env: process.env })`, the CLI's
  `providerEnvMap`, and every `Settings` field in `self-hosted-cloudapi/config/settings.py` (pydantic-settings maps
  field `x_y` to variable `X_Y`) with its readers in `self-hosted-cloudapi/src` and `config/auth.py`.
- Dead: `ROO_CODE_PROVIDER_URL` (and the `tumble-code.cloudProviderUrl` setting, which only feeds the same
  getter), `ROO_SDK_BASE_URL`, the CLI `*_BASE_URL` list (`getBaseUrlFromEnv` has no caller, although
  `apps/cli/README.md` documents them), `AUTHENTIK_APP_SLUG` in the API (the blueprint uses the slug, the API does
  not), `tumble-code.vsCodeLmModelSelector` (only copied by `migrateFromRooCode.ts`; the handler reads the profile
  field). These match D15's "two of them dead" for the cloud URLs (`ROO_CODE_PROVIDER_URL`, `ROO_SDK_BASE_URL`).
- `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` still work through the SDKs: `AnthropicHandler` and
  `OpenAiNativeHandler` pass `baseURL: ... || undefined`, and both SDK clients read the variable
  (`grep -l ANTHROPIC_BASE_URL node_modules/.pnpm/@anthropic-ai+sdk@*/node_modules/@anthropic-ai/sdk/client.js`,
  `grep -l OPENAI_BASE_URL node_modules/.pnpm/openai@*/node_modules/openai/client.js` both print a file).
- Compose passes only the listed variables to the API container (`.dockerignore` excludes `.env*`), so
  `BRIDGE_PATH`, `ENABLE_TASK_SHARING`, `ALLOW_PUBLIC_TASK_SHARING`, `RETENTION_SWEEP_*`, `JWT_PRIVATE_KEY`,
  `JWT_PUBLIC_KEY` take the class default under compose, and `BRIDGE_ENABLED` defaults differ (`true` in the class,
  `false` in compose).
- How-to claims checked against the code: `SETTINGS_DEFAULT_KEYS` are picked by `ProviderStateBuilder.getState`,
  keys without a default need `PASSTHROUGH_SETTING_KEYS`; `ExtensionState` is a `Pick<GlobalSettings, ...>` list;
  `settingsHandlers.updateSettings` stores every received key; `TOOL_DESCRIPTORS` and `TOOL_HANDLERS` are
  `Record<DispatchableToolName, ...>`; `TOOL_MINIMAL_EXAMPLES` has an exhaustiveness `satisfies`; new tool schemas
  go at the end of `getNativeTools` (comment there); `SAY_TOOL_KINDS` is a `Record<ClineSayTool["tool"], ...>`;
  `providerConfigSchemas`, `providerApiKeyFields`, `ProviderUiRegistry` and the CLI `providerEnvMap` are
  exhaustive over the provider ids; `vscode-extension-host-message-types.spec.ts` pins both message-name unions
  and is checked by `tsc`.
- "registry.spec.ts pins routed types": only partly. It asserts that no type belongs to two modules and that
  there are exactly 138 handlers; it does not list names. The routing spec pins 138 route entries and one snapshot
  per entry. Neither compares its list with the other. The how-to page says exactly that.
- Both registry and routing specs pass today (`cd src && npx vitest run core/webview/messageHandlers/__tests__/registry.spec.ts core/webview/__tests__/webviewMessageHandler.routing.spec.ts`: 153 passed).
- The page text in section 6 was formatted with the repository's prettier; the resulting files have the SHA-256
  sums given in step 3.

HYPOTHESIS: none that affects the pages. If another WP merged before this one and changed a named symbol, the
claims check in section 7 shows which row to update.

## 6. Step-by-step changes

All paths are relative to the repository root. Work only in the files named here.

1. Create `docs/09-configuration.md` with exactly the text between the line `````markdown` and the closing line of
   four backticks below (do not include those two lines). Tables are written compact; step 3 pads them.

````markdown
# Configuration: environment variables and VS Code settings

Most behaviour is configured in the Settings view and stored by `ContextProxy` (see
[Persistence](06-persistence.md)). This page lists the two other sources: environment variables, and the few
VS Code settings in the `tumble-code.*` namespace. Every row names the file and symbol that reads the value, so
`grep` finds it.

Status column:

- **live**: read by shipped code.
- **internal**: written and read by the code itself (a child process, a library); not meant to be set by hand.
- **test**: read only by tests, test seams or build tooling.
- **dead**: no shipped code reads it, although something still sets or documents it.

## How variables reach the extension

The extension reads the environment of the VS Code extension host process. In addition, `src/extension.ts`
loads `src/.env` with dotenvx at the top of the module, when the file exists. `src/esbuild.mjs` copies the
repository-root `.env` to `src/.env` on every build (optional copy); `.env.sample` at the root shows the format.
The marketplace release workflow (`.github/workflows/marketplace-publish.yml`) writes `POSTHOG_API_KEY` into that
`.env`, so the key ships inside the VSIX.

The CLI runs the same extension bundle in its own Node process, so everything in the extension table also
applies to the CLI.

## Extension and shared packages

| Variable | Read by (file, symbol) | Default | Purpose | Status |
| --- | --- | --- | --- | --- |
| `ROO_CODE_API_URL` | `packages/cloud/src/config.ts`, `getRooCodeApiUrl` | `https://app.tumblecode.dev` | Cloud API base URL (settings sync, share, telemetry, sign-in pages). See [Cloud URL precedence](#cloud-url-precedence). | live |
| `CLERK_BASE_URL` | `packages/cloud/src/config.ts`, `getClerkBaseUrl` | see [Cloud URL precedence](#cloud-url-precedence) | Base URL of the Clerk-shaped auth API (`/v1/client/...`). | live |
| `ROO_CODE_PROVIDER_URL` | `packages/cloud/src/config.ts`, `getRooCodeProviderUrl` | `https://api.tumblecode.dev/proxy` | Cloud model proxy URL. `getRooCodeProviderUrl` has no caller outside tests. | dead |
| `ROO_CODE_CLOUD_TOKEN` | `packages/cloud/src/cloudEnvironment.ts`, `resolveCloudEnvironment` (from `CloudService.initialize`) | unset | Job token: run as a cloud agent (`StaticTokenAuthService`), no browser sign-in. | live |
| `ROO_CODE_CLOUD_ORG_SETTINGS` | same as above | unset | Organization settings to use instead of fetching them from the cloud. | live |
| `ROO_CODE_DISABLE_TELEMETRY` | `packages/cloud/src/TelemetryClient.ts`, `TelemetryClient.isTelemetryEnabled` | unset | `1` turns cloud telemetry off. | live |
| `POSTHOG_API_KEY` | `packages/telemetry/src/PostHogTelemetryClient.ts`, constructor; `ProviderStateBuilder.getStateToPostToWebview` | `""` | PostHog project key; also sent to the webview as `telemetryKey`. | live |
| `POSTHOG_HOST` | `packages/telemetry/src/PostHogTelemetryClient.ts`, constructor | `http://localhost:8080/telemetry` | PostHog endpoint. | live |
| `ROO_DISABLE_AUTO_MEMORY` | `src/core/memory/paths.ts`, `isAutoMemoryEnabled` | unset | `1`/`true` forces auto memory off, `0`/`false` forces it on; either wins over the setting. | live |
| `ROO_LOG_RAW_USAGE` | `processUsageMetrics` in `src/api/providers/base-openai-compatible-provider.ts` and `openai.ts` | unset | `1` logs the raw usage object of every Chat Completions response. | live |
| `NODE_ENV` | `src/extension.ts`, `activate`, and five more (see below) | unset | `development`: reload on source change, plan review from Vite. `test`: no watchers, test i18n. | live (dev) |
| `VITE_PORT` | `src/core/webview/PlanReviewPanel.ts`, `isDevMode` | unset | Serve the plan-review panel from Vite. Only `PlanReviewPanel.html.spec.ts` sets it. | test |
| `ROO_TEST_LOGS` | `src/utils/logging/index.ts`, module-level logger choice | unset | With `NODE_ENV=test`, `1` turns the real `CompactLogger` on in unit tests. | test |
| `PROGRAMDATA` | `src/services/mdm/MdmService.ts`, `getMdmConfigPath` | `C:\ProgramData` | Windows folder of the MDM policy file (`RooCode\<file>`). | live |
| `GLOBAL_AGENT_HTTP_PROXY`, `GLOBAL_AGENT_HTTPS_PROXY`, `GLOBAL_AGENT_NO_PROXY` | `global-agent` (library); written by `src/utils/networkProxy.ts`, `updateProxyEnvVars` | unset | Written from the `tumble-code.debugProxy.*` settings to route requests through a debug proxy. | internal |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Node and `global-agent`; written by `src/utils/networkProxy.ts`, `applyTlsVerificationOverride` | unset | Set to `0` while `tumble-code.debugProxy.tlsInsecure` is on, restored afterwards. | internal |
| `ROO_ASKPASS_SOCKET`, `ROO_ASKPASS_TOKEN` | the helper script `HELPER_SOURCE` in `src/integrations/terminal/askpass/AskpassServer.ts` | set by the generated shim | Let git, ssh and sudo prompts started from a terminal command reach the extension. | internal |
| `ZDOTDIR` | `src/integrations/terminal/ShellIntegrationManager.ts`, `Terminal.ts` | set per terminal | Temporary zsh config folder for shell integration (setting `terminalZdotdir`). | internal |
| `LANG`, `LC_ALL`, `LC_CTYPE`, `PATH`, `PATHEXT`, `SHELL`, `HOME`, `USERPROFILE`, `APPDATA`, `XDG_DATA_HOME` | `src/integrations/terminal/localeEnv.ts`, `Terminal.ts`, `packages/vscode-shim`, `packages/agent-interchange` | OS | Standard OS variables: UTF-8 locale for commands, executable lookup, home and data folders. | live |
| any name, as `${env:NAME}` in MCP server settings | `src/services/mcp/McpConnectionManager.ts`, through `injectVariables` (`src/utils/config.ts`) | none | Lets an MCP server entry take a value from the environment. | live |

`NODE_ENV` is also read by `src/i18n/setup.ts`, `src/core/config/CustomModesManager.ts`,
`src/services/skills/SkillsManager.ts`, `src/core/webview/PlanReviewPanel.ts` (`isDevMode`) and
`src/utils/logging/index.ts`.

The Anthropic SDK also reads `ANTHROPIC_BASE_URL`, and the OpenAI SDK reads `OPENAI_BASE_URL`, when the handler
passes no base URL. `AnthropicHandler` and `OpenAiNativeHandler` pass `undefined` when the profile has none, so
those two variables change the endpoint of those two providers. No Tumble Code source reads them.

## CLI (`apps/cli`)

The six runtime-contract variables are spelled once in `packages/types/src/cli-runtime.ts` (`CLI_RUNTIME_ENV`,
read with `readCliRuntimeEnv`); see [architecture.md](architecture.md).

| Variable | Read by (file, symbol) | Default | Purpose | Status |
| --- | --- | --- | --- | --- |
| `ROO_CLI_RUNTIME` | `readCliRuntimeEnv(...).isCliRuntime` in `ExecuteCommandTool.ts`, `ModeProfileBinding.ts` | `1`, set by `ExtensionHost` | CLI process: no agent-chosen command timeout, no sticky profile restore. | live |
| `ROO_CLI_CODEX_AUTH_ONLY` | `src/extension.ts`, `activate` | set to `1` by the `tumble auth codex` commands | Activate only the OpenAI Codex OAuth manager and return. | live |
| `ROO_MCP_SETTINGS_PATH` | `src/services/mcp/mcpSettingsPath.ts` | set by `ExtensionHost` (`~/.roo/mcp.json`) | Global MCP servers file instead of `<globalStorage>/settings/mcp_settings.json`. | live |
| `ROO_CLI_ROOT` | `apps/cli/src/agent/extension-host.ts`, `CLI_PACKAGE_ROOT` | set by the launcher from `apps/cli/scripts/build.sh` | Root of the unpacked CLI release. | live |
| `ROO_EXTENSION_PATH` | `apps/cli/src/lib/utils/extension.ts` | set by the launcher | Folder holding `extension.js`. | live |
| `ROO_RIPGREP_PATH` | `src/services/ripgrep/index.ts` | set by the launcher | The ripgrep binary shipped with the CLI. | live |
| `<PROVIDER>_API_KEY` (list below) | `apps/cli/src/lib/utils/provider-types.ts`, `providerEnvMap.keyEnvVar`, `getApiKeyFromEnv` | unset | Key of the active provider when the settings file and flags give none (`resolveProviderConfig`). | live |
| any name, as `apiKeyEnv` in `~/.roo/cli-settings.json` | `apps/cli/src/lib/utils/provider-config.ts`, `resolveProviderConfig` | none | Names the variable that holds the key. | live |
| `<PROVIDER>_BASE_URL` (list below) | `apps/cli/src/lib/utils/provider-types.ts`, `providerEnvMap.baseUrlEnvVar`, `getBaseUrlFromEnv` | unset | Meant as base-URL overrides; `getBaseUrlFromEnv` has no caller (see below). | dead |
| `ROO_AUTH_BASE_URL` | `apps/cli/src/types/constants.ts`, `AUTH_BASE_URL` (used by `commands/auth/login.ts`) | `http://localhost:3000` | Sign-in page of `tumble auth login`. | live |
| `ROO_SDK_BASE_URL` | `apps/cli/src/types/constants.ts`, `SDK_BASE_URL` | `http://localhost:3001` | `SDK_BASE_URL` has no reader. | dead |
| `ROO_CLI_FAKE_AI_MODULE` | `apps/cli/src/lib/utils/fake-ai-module.ts`, `loadFakeAiProviderSettings` | unset | Test seam of `apps/cli/scripts/integration`: runs the hidden `fake-ai` provider with a scripted model. | test |
| `DEBUG` | `packages/vscode-shim/src/utils/logger.ts`; `apps/cli/src/commands/auth/openai-codex.ts` | unset | Any value prints the shim's debug lines and the Codex login's warnings. | live |
| `ROO_VERSION` | the install script started by `apps/cli/src/commands/cli/upgrade.ts`, `runUpgradeInstaller` | set by `tumble upgrade` (latest version) | Version for the installer to fetch. | internal |

The provider variables, from `providerEnvMap`:

- API keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (openai-native and openai), `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`,
  `LITELLM_API_KEY`, `DEEPSEEK_API_KEY`, `OLLAMA_API_KEY`, `MISTRAL_API_KEY`, `MOONSHOT_API_KEY`, `MINIMAX_API_KEY`,
  `XAI_API_KEY`, `ZAI_API_KEY`. Also read by `commands/cli/list.ts`.
- Base URLs (dead): `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `GOOGLE_GEMINI_BASE_URL`, `OPENROUTER_BASE_URL`,
  `LITELLM_BASE_URL`, `DEEPSEEK_BASE_URL`, `OLLAMA_BASE_URL`, `LMSTUDIO_BASE_URL`, `AWS_BEDROCK_ENDPOINT`,
  `MISTRAL_BASE_URL`, `MOONSHOT_BASE_URL`, `MINIMAX_BASE_URL`. `apps/cli/README.md` says the CLI honours them, but no
  code calls `getBaseUrlFromEnv`. Only the SDK fallback described above applies (`ANTHROPIC_BASE_URL` for
  anthropic, `OPENAI_BASE_URL` for openai-native).

## `packages/agent-interchange`

| Variable | Read by (file, symbol) | Default | Purpose | Status |
| --- | --- | --- | --- | --- |
| `CLAUDE_CONFIG_DIR` | `src/locate.ts`, `claudeConfigDir` | `~/.claude` | Where Claude Code keeps its sessions. | live |
| `AGENT_INTERCHANGE_TUMBLE_STORAGE` | `src/locate.ts`, `tumbleStorageRoots` | `customStoragePath`, then VS Code storage | Tumble Code's globalStorage folder (the one holding `tasks/`). | live |
| `AGENT_INTERCHANGE_DIR` | `src/locate.ts`, `handoffDir` | `$XDG_DATA_HOME/agent-interchange/handoffs` | Where handoff documents are written. | live |
| `AGENT_INTERCHANGE_ALLOW_CROSS_WORKSPACE` | `src/mcp/index.ts`, `main` | unset | `1` lets the MCP server read sessions of other workspaces. | live |
| `AGENT_INTERCHANGE_TUMBLE_MCP_CONFIG` | `src/install/index.ts`, `parseArgs` | none (required unless `--tumble-config`) | Tumble Code MCP settings file the installer edits. | live |

## Build-time values

These are replaced at build time (esbuild or Vite `define`), not read at run time.

| Name | Used in | Set by | Default when not set |
| --- | --- | --- | --- |
| `PKG_NAME`, `PKG_VERSION`, `PKG_OUTPUT_CHANNEL`, `PKG_SHA` | `src/shared/package.ts`, `Package` | `apps/vscode-nightly/esbuild.mjs`, `webview-ui/vite.config.ts` | `name` and `version` of `src/package.json`, `Tumble-Code`, unset |
| `PKG_VERSION` | `webview-ui/src/components/ErrorBoundary.tsx`, `webview-ui/src/vite-plugins/sourcemapPlugin.ts` | `webview-ui/vite.config.ts` | none |
| `VSCODE_TEXTMATE_DEBUG` | no source in `webview-ui/src` | `webview-ui/vite.config.ts` (copied from the build environment) | unset |
| `NODE_ENV` | `webview-ui/src/App.tsx`, `webview-ui/src/utils/sourceMapInitializer.ts`; React in the CLI | Vite; `apps/cli/src/lib/utils/react-production.ts` sets it while React loads | `production` in Vite builds |

The normal extension build (`src/esbuild.mjs`) defines none of the `PKG_*` names, so the extension uses
`src/package.json`. Test infrastructure also reads `CI` (`src/vitest.config.ts`) and `GITHUB_ACTIONS`
(`src/utils/vitest-verbosity.ts`).

## Self-hosted cloud API (`self-hosted-cloudapi`)

`config/settings.py` defines `Settings`, a pydantic-settings class. Each field is read from the environment
variable of the same name in upper case, then from the env file. The env file is `.env` in the working folder,
or the file named by `CLOUDAPI_ENV_FILE` (empty: no file; the test suite sets it empty). Unknown keys in the
file are ignored (`extra="ignore"`), so the compose-only keys can share it.

With Docker Compose, the API container receives only the variables listed under `services.api.environment` in
`docker-compose.yml`; the image has no `.env` (`.dockerignore` excludes it). A field missing from that list takes
the class default, whatever the host `.env` says. The "Compose" column shows what the compose file passes.

| Variable | Read by (file, symbol) | Class default | Compose | Purpose | Status |
| --- | --- | --- | --- | --- | --- |
| `CLOUDAPI_ENV_FILE` | `config/settings.py`, `Settings.model_config` | `.env` | not passed | Env file to read; empty reads none. | live |
| `DATABASE_URL` | `src/database.py` | required | `postgresql://roo:password@postgres:5432/roo_cloud` | Database connection string. | live |
| `SECRET_KEY` | `src/auth/web_session.py` | required, 32+ chars | `${SECRET_KEY}` (placeholder refused) | Signs web session cookies and tickets. | live |
| `API_BASE_URL` | `src/main.py`, `src/auth/origins.py`, `web_session.py`, `share_service.py`, `bridge_service.py` | required | `http://localhost:8085` | Public URL of the API; always a trusted origin. | live |
| `PORT` | `src/main.py` (direct run); `docker-entrypoint.sh` (`uvicorn --port`) | `8085` | `8085` | Listen port. | live |
| `LOG_LEVEL` | `src/main.py` | `INFO` | `INFO` | Level of the service's own log lines. | live |
| `JWT_ALGORITHM` | `src/auth/jwt_issuer.py`, `src/main.py` | `HS256` | `HS256` | Session JWT algorithm. | live |
| `JWT_SECRET` | `src/auth/jwt_issuer.py` | none; required for `HS*` | `${JWT_SECRET}` (placeholder refused) | HMAC key for session JWTs. | live |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | `src/auth/jwt_issuer.py` | none | not passed | Key pair for an asymmetric `JWT_ALGORITHM`. | live |
| `CLIENT_TOKEN_IDLE_DAYS` | `src/services/auth_service.py` | `30` | `30` | Days a client token may go unused; `0` never expires. | live |
| `AUTHENTIK_BASE_URL` | `config/auth.py`, `src/main.py` | required | `http://localhost:9000` | Browser-facing Authentik URL. | live |
| `AUTHENTIK_INTERNAL_URL` | `config/auth.py` | `AUTHENTIK_BASE_URL` | `http://auth_server:9000` | Authentik URL for server-to-server calls. | live |
| `AUTHENTIK_APP_SLUG` | nothing (`authentik_app_slug` has no reader) | `tumble-code` | `tumble-code` | Meant for app-specific endpoints; the API uses only the global `/application/o/...` ones. | dead |
| `AUTHENTIK_CLIENT_ID` | `src/auth/authentik.py` | required | `tumble-code` | OAuth client id (also read by the Authentik blueprint). | live |
| `AUTHENTIK_CLIENT_SECRET` | `src/auth/authentik.py` | none | empty | OAuth client secret. | live |
| `AUTHENTIK_REDIRECT_URI` | `src/auth/authentik.py`, `config/auth.py` | required | `http://localhost:8085/auth/clerk/callback` | OAuth callback URL. | live |
| `CORS_ORIGINS` | `src/auth/origins.py` (via `cors_origins_list`), `src/main.py` | empty | empty | Extra trusted origins for CORS, the bridge and CSRF; `*` is ignored with a warning. | live |
| `WEB_ALLOWED_NETWORKS` | `src/auth/network_access.py`, `src/main.py` | empty (open) | empty | IPs and CIDR networks allowed to open `/app`. | live |
| `WEB_PUBLIC_URL` | `config/auth.py`, `src/auth/origins.py`, `src/auth/web_session.py`, `src/routers/browser.py`, `src/main.py` | none | empty | Address other machines use to reach the panel (also read by the blueprint). | live |
| `MARKETPLACE_SOURCE` | `src/services/marketplace_service.py` | `yaml` | `yaml` | Anything but `yaml` serves an empty marketplace. | live |
| `MARKETPLACE_YAML_DIR` | `src/services/marketplace_service.py` | `./config/marketplace` | `./config/marketplace` | Folder of the marketplace YAML files. | live |
| `BRIDGE_ENABLED` | `src/main.py`, `src/routers/extension.py`, `src/routers/shared.py`, `src/routers/web_tasks.py` | `true` | `false` unless set | Mounts the socket.io bridge. Note the different defaults. | live |
| `BRIDGE_PATH` | `src/main.py`, `src/routers/shared.py`, `src/routers/web_tasks.py`, `src/services/bridge_service.py` | `/bridge/socket.io` | not passed | socket.io path, at least two segments. | live |
| `TELEMETRY_ENABLED` | `src/main.py`, `src/routers/events.py` | `true` | `true` | `false` accepts and drops telemetry. | live |
| `BACKFILL_MAX_BYTES` | `src/routers/events.py` | `52428800` | `52428800` | Largest accepted task upload. | live |
| `ENABLE_TASK_SHARING`, `ALLOW_PUBLIC_TASK_SHARING` | `src/services/settings_service.py`, `src/services/share_service.py` | `true` | not passed | Advertise and allow task sharing without an organization. | live |
| `RATE_LIMIT_ENABLED`, `RATE_LIMIT_REQUESTS_PER_MINUTE` | `src/main.py`, `src/middleware/rate_limit.py` | `true`, `60` | `true`, `60` | Per-IP rate limit. | live |
| `RETENTION_SWEEP_ENABLED`, `RETENTION_SWEEP_HOURS` | `src/main.py`, `src/services/retention_scheduler.py` | `true`, `6` | not passed | Background deletion by each user's retention policy. | live |

Variables used only by `docker-compose.yml` and the Authentik containers (not by the API): `PG_DB`, `PG_USER`,
`AUTH_PG_PASS`, `AUTHENTIK_SECRET_KEY`, `AUTHENTIK_BOOTSTRAP_PASSWORD`, `AUTHENTIK_BOOTSTRAP_EMAIL`,
`AUTHENTIK_BOOTSTRAP_TOKEN`, `AUTH_DB_PORT`, `COMPOSE_PORT_HTTP`, `COMPOSE_PORT_HTTPS`, `AUTHENTIK_IMAGE`,
`AUTHENTIK_TAG`. The blueprint `authentik/blueprints/tumble-code.yaml` reads `AUTHENTIK_CLIENT_ID`,
`AUTHENTIK_CLIENT_SECRET`, `AUTHENTIK_REDIRECT_URI` and `WEB_PUBLIC_URL` with `!Env`. `.env.example` documents
the whole set.

## VS Code settings (`tumble-code.*`)

Declared in `src/package.json` under `contributes.configuration`, described in `src/package.nls*.json`, read with
`vscode.workspace.getConfiguration(Package.name)`. `src/utils/migrateFromRooCode.ts` copies them once from the old
`roo-cline.*` namespace (`CONFIG_KEYS_TO_MIGRATE`).

| Key | Default | Read by |
| --- | --- | --- |
| `allowedCommands`, `deniedCommands` | `["git log","git diff","git show"]`, `[]` | `src/core/auto-approval/index.ts`, `ProviderStateBuilder.ts` (merged with the settings-view lists) |
| `commandExecutionTimeout` | `0` | `src/core/tools/ExecuteCommandTool.ts` |
| `commandTimeoutAllowlist` | `[]` | `src/core/tools/ExecuteCommandTool.ts` |
| `preventCompletionWithOpenTodos` | `false` | `src/core/tools/AttemptCompletionTool.ts` |
| `vsCodeLmModelSelector` | unset | only the migration; the VS Code LM handler reads the profile field of the same name |
| `customStoragePath` | `""` | `src/utils/storage.ts` |
| `enableCodeActions` | `true` | `src/activate/CodeActionProvider.ts` |
| `autoImportSettingsPath` | `""` | `src/utils/autoImportSettings.ts` |
| `maximumIndexedFilesForFileSearch` | `10000` | `src/services/search/file-search.ts` |
| `useAgentRules` | `true` | `src/core/prompts/system-prompt-input.ts` |
| `apiRequestTimeout` | `600` | `src/api/providers/utils/timeout-config.ts` |
| `newTaskRequireTodos` | `false` | `src/core/prompts/system-prompt-input.ts`, `src/core/tools/NewTaskTool.ts` |
| `codeIndex.embeddingBatchSize` | `60` | `src/services/code-index/` (`scanner.ts`, `file-watcher.ts`, `service-factory.ts`) |
| `debug` | `false` | `src/extension.ts`, `ProviderStateBuilder.ts`, `src/utils/logging/CompactLogger.ts` |
| `debugProxy.enabled`, `debugProxy.serverUrl`, `debugProxy.tlsInsecure` | `false`, `http://127.0.0.1:8888`, `false` | `src/utils/networkProxy.ts` |
| `cloudApiUrl`, `cloudProviderUrl`, `clerkBaseUrl` | `""` | `src/activate/cloud-urls.ts`, `syncCloudUrls` (runtime overrides of the three cloud URL variables) |

### Cloud URL precedence

Highest first: the VS Code setting, then the environment variable, then the production
default. `CLERK_BASE_URL` alone adds a step before the default: a non-production API URL is used as the auth URL
too, because the self-hosted API serves both. `cloudProviderUrl` is stored like the other two but, like
`ROO_CODE_PROVIDER_URL`, nothing reads the result.
````

2. Create `docs/10-how-to.md` the same way from the block below (the inner three-backtick `sh` blocks are part of
   the page).

````markdown
# How to: add a setting, a tool, a provider or a webview message

Step-by-step recipes for the four most common additions. Each lists every file to touch, in order, and the specs
that pin the result. Copy the named example end to end; the compiler catches most missing rows because the
tables are typed `Record<...>` or checked with `satisfies`. Run the commands in "Check" at the end of each recipe.

Before you start, read [architecture.md](architecture.md) (dependency directions, "do not touch") and the test
placement rules in `AGENTS.md`.

## Add a setting (Settings view, stored in `globalState`)

Example to copy: `maxGitStatusFiles` (a number with a default, shown in Context Management). Search for it with
`grep -rn maxGitStatusFiles packages src webview-ui/src`.

1. **Schema.** `packages/types/src/global-settings.ts`, `globalSettingsSchema`: add `mySetting: z.boolean().optional()`.
   `ContextProxy` stores every key of this schema (`GLOBAL_STATE_KEYS` is derived from it), so no storage code
   changes. A secret goes to `GLOBAL_SECRET_KEYS` in the same file instead of plain state.
2. **Default.** `packages/types/src/settings-defaults.ts`, `settingsDefaults`: add `mySetting: false`. `resolveSettings`
   then fills it in `getState()` and in the state posted to the webview (`ProviderStateBuilder` picks every
   `SETTINGS_DEFAULT_KEYS` key). A setting without a static default is not in that table: add its key to
   `PASSTHROUGH_SETTING_KEYS` in `src/core/webview/ProviderStateBuilder.ts`, otherwise `getState()` drops it.
3. **Webview state type.** `packages/types/src/vscode-extension-host.ts`, `ExtensionState`: add `| "mySetting"` to
   the `Pick<GlobalSettings, ...>` list. Without it the Settings view cannot hold the key (`BufferableSettingsKey`).
4. **Host code that uses it.** Read the resolved value: `const { mySetting } = await provider.getState()` (from a
   tool: `await task.providerRef.deref()?.getState()`). Where a value can be unset, write
   `?? SETTINGS_DEFAULTS.mySetting`, never a literal. If a change must take effect at once (like the terminal
   settings), add a branch to `settingsHandlers.updateSettings` in `src/core/webview/messageHandlers/settings.ts`;
   a plain value needs nothing there, the loop stores every key it receives.
5. **Save buffer row.** `webview-ui/src/components/settings/schema.ts`, `SETTINGS_SCHEMA`: add
   `mySetting: { apply: "onSave", default: SETTINGS_DEFAULTS.mySetting },`. Use `apply: "immediate"` only when the
   change must reach the host before Save. The row's position is the order Save sends it.
6. **Control.** In the section component (for example `webview-ui/src/components/settings/ContextManagementSettings.tsx`):
   add `mySetting?: boolean` to the props type, add `"mySetting"` to the key union of its `setCachedStateField`
   type, and render the control with `setCachedStateField("mySetting", value)`. In `SettingsView.tsx` pass
   `mySetting={settings.mySetting}`; `settings` there is the `cachedState` buffer. Bind to the buffer, never to
   `useExtensionState()` (rule in `AGENTS.md`).
7. **Text.** Add `"mySetting": { "label": "...", "description": "..." }` under the section's object in
   `webview-ui/src/i18n/locales/en/settings.json` and in the same place in the 17 other locales (`ca`, `de`, `es`,
   `fr`, `hi`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt-BR`, `ru`, `tr`, `vi`, `zh-CN`, `zh-TW`). Use the key
   literally, `t("settings:contextManagement.mySetting.label")`, so `scripts/find-unused-i18n-keys.mjs` sees it.
8. **Tests.**
    - Behaviour: a spec at the lowest layer that uses the value (for `maxGitStatusFiles`,
      `src/core/environment/__tests__/getEnvironmentDetails.spec.ts`), and a control test next to the section
      (`webview-ui/src/components/settings/__tests__/ContextManagementSettings.spec.tsx`).
    - Pinned characterizations you must update: the expected payload in
      `webview-ui/src/components/settings/__tests__/SettingsView.save-defaults.spec.tsx` ("sends today's fallback
      for every field"), and the golden snapshots of `src/core/webview/__tests__/ClineProvider.stateBuilder.spec.ts`
      (run it with `-u` and check the diff adds only your key).
    - Guarded automatically: `packages/types/src/__tests__/settings-defaults.spec.ts` (every default is a real key)
      and `webview-ui/src/components/settings/__tests__/schema.spec.ts` (the row default equals `SETTINGS_DEFAULTS`).

Check:

```sh
node scripts/find-missing-translations.js --area=webview
cd packages/types && npx vitest run src/__tests__/settings-defaults.spec.ts && npx tsc --noEmit
cd webview-ui && npx vitest run src/components/settings && npx tsc
cd src && npx vitest run core/webview/__tests__/ClineProvider.stateBuilder.spec.ts
```

### A VS Code setting instead (`tumble-code.*`)

Use this only for values that must live in the VS Code settings file (see the table in
[Configuration](09-configuration.md)). Add the key under `contributes.configuration` in `src/package.json` with
`"description": "%settings.myKey.description%"`, add that string to `src/package.nls.json` and the 17
`src/package.nls.<locale>.json` files, and read it with
`vscode.workspace.getConfiguration(Package.name).get<boolean>("myKey")`. Check with
`node scripts/find-missing-translations.js --area=package-nls`.

## Add a native tool

Example to copy: `list_files` (read-only, asks for approval, one chat row). `search_task_history` is the most
recent addition and shows a tool that reports with a `say` row instead of an approval ask. The overview of the
pieces is in [Tools and providers](04-tools-and-providers.md).

1. **Name and catalog.** `packages/types/src/tool.ts`:
    - `toolNames`: add `"my_tool"`.
    - `toolParamNames`: add every parameter name the tool uses that is not listed yet.
    - `TOOL_DISPLAY_NAMES` (a `Record<ToolName, string>`, so the compiler asks for it): `my_tool: "do my thing"`.
    - `TOOL_GROUPS`: add it to the group whose modes may use it (`read`, `edit`, `command`, `mcp`, `modes`, `web`),
      or to `ALWAYS_AVAILABLE_TOOLS`. A tool in no group is never offered to the model.
2. **Chat payload name.** `packages/types/src/vscode-extension-host.ts`, `ClineSayTool["tool"]`: add `"myTool"`,
   the camelCase name the tool's chat messages carry.
3. **Payload family.** `packages/core/src/message-utils/toolPayload.ts`, `SAY_TOOL_KINDS` (compile-checked against
   the union from step 2): `myTool: "myTool"`, and add `"myTool"` to `ToolPayloadKind` when it is a new family.
   A new family also needs its title in `KIND_DISPLAY_NAMES` in `apps/cli/src/ui/components/tools/utils.ts`
   (compile-checked) and, optionally, a CLI renderer category in `KIND_CATEGORIES` in
   `apps/cli/src/ui/components/tools/types.ts`.
4. **Typed arguments.** `src/shared/tools.ts`, `NativeToolArgs`: `my_tool: { path: string; recursive?: boolean }`.
5. **Schema the model sees.** Copy `src/core/prompts/tools/native-tools/list_files.ts` to `my_tool.ts` and edit
   the name, description and parameters. It is `strict: true`, so every property is listed in `required`; an
   optional one is typed `["string", "null"]`. In `src/core/prompts/tools/native-tools/index.ts` import it and add
   it at the **end** of the array in `getNativeTools`: the tool array is part of the cached request prefix, and a
   schema inserted in the middle costs every user their cache hit.
6. **Minimal example.** `src/core/prompts/tools/native-tools/examples.ts`, `TOOL_MINIMAL_EXAMPLES`: one call with
   only the required parameters. Weak models are shown it after a malformed call; `examples.spec.ts` checks it
   against the schema.
7. **Argument parser.** `src/core/tools/toolArgParsers.ts`: add
   `export const parseMyToolArgs: ToolArgParser = (raw) => raw.path !== undefined ? built({ path: raw.path, recursive: coerceOptionalBoolean(raw.recursive) }) : undefined`
   (the `parseListFilesArgs` pattern). Return `undefined` while a required field is missing; coerce strings to
   numbers and booleans, weak models send them.
8. **Descriptor row.** `src/core/tools/toolDescriptors.ts`: import the parser and add a `TOOL_DESCRIPTORS` row
   (the table is keyed by every tool name, so the build fails without it). Copy the `list_files` row and decide
   each flag: `approvalCategory` and `approvalActions: ["myTool"]` (auto-approval derives its lists from these),
   `requiresCheckpoint` for a tool that writes the workspace, `workspaceReadOnly`, `compactable`, `spillExempt`,
   `slimAllowed`, `ledger`, and `describe`.
9. **Implementation.** `src/core/tools/MyToolTool.ts`: `export class MyToolTool extends BaseTool<"my_tool">` with
   `readonly name = "my_tool" as const` and `execute(params, task, { askApproval, handleError, pushToolResult, toolCallId })`.
   Follow `ListFilesTool.execute`: validate (`task.sayAndCreateMissingParamError`), reset
   `task.consecutiveMistakeCount`, do the work, `askApproval("tool", JSON.stringify({ tool: "myTool", ..., toolCallId }))`,
   then `pushToolResult(result)`; errors go to `handleError`. Override `handlePartial` to show the row while the
   arguments stream. Keep no per-call state on the class: one instance serves every task. End the file with
   `export const myToolTool = new MyToolTool()`.
10. **Handler row.** `src/core/assistant-message/toolHandlers.ts`, `TOOL_HANDLERS` (also keyed by every tool name):
    import and add `my_tool: myToolTool`.
11. **Chat row.** `webview-ui/src/components/chat/rows/renderers/tool/index.ts`, `TOOL_RENDERERS`: add
    `myTool: MyToolRow` (for a tool that raises an approval ask; a payload with no entry renders nothing). A tool
    that only reports uses `SAY_TOOL_RENDERERS` in `webview-ui/src/components/chat/rows/renderers/say/SayToolRows.tsx`.
    Put the row's text in `webview-ui/src/i18n/locales/*/chat.json` (all 18 locales). Button labels for the ask
    default to Approve and Reject (`webview-ui/src/components/chat/hooks/useAskButtons.ts`).
12. **Optional.** `packages/agent-interchange/src/tools.ts`, `TUMBLE_TOOLS`: classify the tool for session handoff.
13. **Tests.**
    - New: `src/core/tools/__tests__/MyToolTool.spec.ts` (see `SearchTaskHistoryTool.spec.ts` or `WebTools.spec.ts`)
      and parser cases in `src/core/tools/__tests__/toolArgParsers.spec.ts`.
    - Lists that pin every tool (add your tool to each):
      `src/core/assistant-message/__tests__/presentAssistantMessage-dispatch-table.spec.ts` (`DISPATCH`),
      `src/core/assistant-message/__tests__/NativeToolCallParser.args-snapshot.spec.ts` (`CASES`),
      `src/core/auto-approval/__tests__/approvalCategories.spec.ts` (both expected maps),
      `src/core/tools/__tests__/tool-policy-lists.spec.ts` (the read-only, compactable, spill and slim lists your
      flags put it in), `src/core/prompts/tools/__tests__/slim-toolset.spec.ts` when `slimAllowed`.
    - Snapshots that change (run with `-u`, then read the diff): `approvalMatrix.spec.ts`,
      `NativeToolCallParser.args-snapshot.spec.ts`, and the tool-array snapshots in `src/api/providers/__tests__/`
      (`strict-schema-characterization.spec.ts`, `base-provider.spec.ts`); system-prompt snapshots under
      `src/core/prompts/__tests__/__snapshots__/` when the tool's group is in those modes.
    - Payload and row maps: `packages/core/src/message-utils/__tests__/toolPayload.spec.ts`,
      `apps/cli/src/ui/components/__tests__/toolPayloadParity.test.tsx`,
      `webview-ui/src/components/chat/rows/__tests__/toolRendererDispatch.spec.ts`.

Check:

```sh
pnpm check-types
cd src && npx vitest run core/tools core/assistant-message core/auto-approval core/prompts api/providers/__tests__/strict-schema-characterization.spec.ts api/providers/__tests__/base-provider.spec.ts
cd packages/core && npx vitest run src/message-utils
cd webview-ui && npx vitest run src/components/chat
cd apps/cli && npx vitest run src/ui/components
```

## Add a provider

Example to copy: `moonshot`, an OpenAI-compatible API with a static model list, handled by a subclass of
`BaseOpenAiCompatibleProvider` (the most common case). Every file below is one `grep -rli moonshot` finds; do the
same for your id when you are done. Below, `acme` is the new id, `Acme` its component name.

`packages/types/src/`:

1. `providers/acme.ts`: `acmeModels` and `acmeDefaultModelId` (copy `providers/moonshot.ts`); export it from
   `providers/index.ts`.
2. `provider-registry.ts`, `providerRegistry`: `{ id: "acme", lifecycle: "active", label: "Acme", displayOrder: <unused number> }`.
   `ProviderName` and the selector list derive from this.
3. `provider-config/configs.ts`: `export const acmeConfigSchema = apiModelConfigSchema.extend({ acmeBaseUrl: z.string().optional() })`.
   `provider-config/index.ts`: import it, add `acme: acmeConfigSchema` to `providerConfigSchemas` (checked with
   `satisfies`) and a row to `knownProviderConfigurationSchema`.
4. `provider-settings.ts`: `const acmeSchema = legacyProviderArm(providerConfigSchemas.acme, { acmeApiKey: optionalCredential() })`,
   then add `acmeSchema.merge(z.object({ apiProvider: z.literal("acme") }))` to `providerSettingsSchemaDiscriminated`
   and `...acmeSchema.shape` to `providerSettingsSchema`. The flat schema is on the "do not touch" list: only add.
5. `global-settings.ts`, `SECRET_STATE_KEYS`: add `"acmeApiKey"`, so the key is kept in SecretStorage.
6. `provider-validation.ts`: `acme: "acmeApiKey"` in `providerApiKeyFields` and `acme: apiKeyValidation("acme")`
   in the validation table (both compile-checked).
7. `provider-models.ts`, `providerModelDefinitions`: `acme: { modelIdField: "apiModelId", models: acmeModels, defaultModelId: acmeDefaultModelId, unknownModelPolicy: "keep-id" }`.
8. `provider-model-selection.ts`: add `case "acme":` next to `case "moonshot":` (the `resolveCatalogModel` group).

`src/api/`:

9. `providers/acme.ts`: copy `providers/moonshot.ts`, rename the class to `AcmeHandler`, set `providerName`,
   `baseURL` (`options.acmeBaseUrl || ACME_DEFAULT_BASE_URL`), `apiKey`, the model list and the catalog lookup.
   Drop Moonshot's usage quirks you do not need.
10. `providers/index.ts`: `export { AcmeHandler } from "./acme"`.
11. `runtime-provider-registry.ts`: import `AcmeHandler`, add `"acme"` to the id union of `resolveListedModel`, and
    add `acme: defineRuntimeProvider("acme", { factory: (options) => new AcmeHandler(options), resolveModel: resolveListedModel("acme") })`.

`webview-ui/src/`:

12. `components/settings/providers/Acme.tsx`: copy `Moonshot.tsx` (base URL field and `ApiKeyField`); export it from
    `components/settings/providers/index.ts`.
13. `components/settings/provider-ui-registry.tsx`: add `"acme"` to `ProviderFormId` and a
    `acme: simpleForm("acme", "acme", (context) => <Acme ... />)` row (the registry must cover every `ProviderName`).
14. `components/settings/ApiOptions.tsx`, `PROVIDER_MODEL_CONFIG`: `acme: { field: "apiModelId", default: acmeDefaultModelId }`.
15. `components/ui/hooks/useSelectedModel.ts`: a `case "acme":` like the `moonshot` one.
16. `components/settings/utils/providerModelConfig.ts`, `PROVIDER_SERVICE_CONFIG`: service name and URL.
17. `i18n/locales/*/settings.json`: `providers.acmeApiKey`, `providers.getAcmeApiKey` and any field label, in all
    18 locales.

`apps/cli/`:

18. `src/lib/utils/provider-types.ts`, `providerEnvMap` (a `Record` over the CLI's providers): `acme: { keyEnvVar: "ACME_API_KEY" }`,
    plus `baseUrlField: "acmeBaseUrl"` when the schema has one. List it in the provider table of `apps/cli/README.md`.

Tests:

- New: `src/api/providers/__tests__/acme.spec.ts` (copy `moonshot.spec.ts`; the wire and stream-error specs of
  Moonshot are further examples).
- Lists that pin every provider: `packages/types/src/__tests__/provider-registry.spec.ts`,
  `provider-validation.spec.ts`, `provider-settings-arms.spec.ts` (snapshot, `-u`), `src/api/__tests__/runtime-provider-registry.spec.ts`,
  `src/api/__tests__/provider-definitions.spec.ts`, `webview-ui/src/components/settings/__tests__/provider-ui-registry.spec.tsx`,
  `provider-forms.table.spec.tsx`, `webview-ui/src/utils/__tests__/provider-validation-registry.spec.ts`.
- Optional contract coverage: add the handler to `src/api/providers/__tests__/cancellation-contract.spec.ts` and
  `error-contract.spec.ts`.

Check: `pnpm check-types`, then the specs above, then
`node scripts/find-missing-translations.js --area=webview`.

## Add a webview-to-host message

Example to copy: `getWorktreeDefaults` (the webview asks, the host answers with `worktreeDefaults`). The path of a
message is described in [architecture.md](architecture.md), "From the webview to a handler".

1. **Type name.** `packages/types/src/vscode-extension-host.ts`: add `"myMessage"` to the per-domain union it
   belongs to (for example `WebviewWorktreeMessageType`). New payload fields go on `WebviewMessage` as optional
   fields; the shape is public, change it only by adding. An answer needs its own name in the matching
   `Extension...MessageType` union and optional fields on `ExtensionMessage`.
2. **Pinned name list.** `packages/types/src/__tests__/vscode-extension-host-message-types.spec.ts`: add the name to
   `ExpectedWebviewMessageType` (and the answer to `ExpectedExtensionMessageType`). This spec is checked by `tsc`,
   so `packages/types` fails to type-check until you do.
3. **Handler.** `src/core/webview/messageHandlers/<domain>.ts`: add a row to the module's `MessageHandlerMap`:
   `myMessage: async (ctx, message) => { const { provider } = ctx; ...; await provider.postMessageToWebview({ type: "myAnswer", ... }) }`.
   The map is keyed by `WebviewMessage["type"]`, so a name missing from step 1 does not compile. A new domain
   module must also be listed in `messageHandlerGroups` in `src/core/webview/messageHandlers/index.ts`.
4. **Registry count.** `src/core/webview/messageHandlers/__tests__/registry.spec.ts`: raise the expected number of
   routed types by one (`toHaveLength(138)` today) and update the test title. The spec checks that no type is
   claimed by two modules and counts the handlers; it does not list names.
5. **Routing characterization.** `src/core/webview/__tests__/webviewMessageHandler.routing.spec.ts`: add
   `["myMessage", { /* representative fields */ }]` to `ROUTES`, raise `expect(ROUTED_TYPES).toHaveLength(138)` by
   one, and mock any new module the handler calls with `h.fn(...)` like the existing `vi.mock` blocks. Then write
   the one new snapshot entry:
   `cd src && npx vitest run core/webview/__tests__/webviewMessageHandler.routing.spec.ts -u`. The `.snap` diff must
   add exactly one entry and change nothing else. (With `CI` set, Vitest does not write new snapshots and the
   test fails.)
6. **Webview side.** Send with `vscode.postMessage({ type: "myMessage", ... })` (`webview-ui/src/utils/vscode.ts`).
   Receive the answer with `useExtensionMessage("myAnswer", handler)` or `onExtensionMessage` from
   `webview-ui/src/utils/extensionBus.ts`; `request(...)` there correlates by request id when the host echoes one.
7. **Tests.** Put the handler's behaviour in a focused spec next to the code it calls (the routing snapshot only
   records side effects), and the webview part in a component spec.

Check:

```sh
cd packages/types && npx tsc --noEmit
cd src && npx vitest run core/webview/messageHandlers core/webview/__tests__/webviewMessageHandler.routing.spec.ts
cd webview-ui && npx tsc
```
````

3. Format the two new pages and check the result byte for byte:

```sh
node_modules/.bin/prettier --write docs/09-configuration.md docs/10-how-to.md
sha256sum docs/09-configuration.md docs/10-how-to.md
```

Expected (the "Ignored unknown option" warning of prettier is harmless):

```text
44d171bada0dd103c63caf96bae0413407642db51bda772ac402a07dad5b0085  docs/09-configuration.md
4a6980c715697ae12af3d237c2a3fe295fb743e0e6c6fa84931ba9bfbec75542  docs/10-how-to.md
```

If a sum differs, the paste changed something (a lost trailing newline, a tab, a curly quote). Compare with the
fenced text and fix; do not edit the content otherwise.

4. `docs/README.md`: find

```markdown
| 3     | [Persistence](06-persistence.md)                 | Where settings, secrets, tasks and history live, and how writes stay atomic.          |
```

and replace it with (three lines; the new answers are at most 85 characters, so the other rows keep their padding):

```markdown
| 3     | [Persistence](06-persistence.md)                 | Where settings, secrets, tasks and history live, and how writes stay atomic.          |
| 3     | [Configuration](09-configuration.md)             | Every environment variable and `tumble-code.*` setting: reader, default, dead ones.   |
| 3     | [How to](10-how-to.md)                           | Recipes with every file to touch: a setting, a tool, a provider, a webview message.   |
```

5. `docs/04-tools-and-providers.md`, three edits:

   5a. Find

```markdown
| Argument parsing (partial and complete)                                | `src/core/assistant-message/toolArgParsers.ts`                 |
```

   replace with

```markdown
| Argument parsing (partial and complete)                                | `src/core/tools/toolArgParsers.ts`                             |
```

   5b. Find the last row of the same table

```markdown
| Chat row in the panel                                                  | `webview-ui/src/components/chat/rows/renderers/tool/`          |
```

   and replace it with that row, a blank line, and two lines of text:

```markdown
| Chat row in the panel                                                  | `webview-ui/src/components/chat/rows/renderers/tool/`          |

The step-by-step recipe, with every file and the specs that pin the tool lists, is in
[How to: add a native tool](10-how-to.md#add-a-native-tool).
```

   5c. Find

```markdown
selection helpers in `webview-ui`. Copy the most similar existing provider and follow the compiler errors.
```

   replace with

```markdown
selection helpers in `webview-ui`. Copy the most similar existing provider and follow the compiler errors. The
full list, in order, is in [How to: add a provider](10-how-to.md#add-a-provider).
```

6. `docs/architecture.md`: find

```markdown
- `src/eslint.config.mjs` forbids importing `vscode` in `src/shared`, because the webview bundles that folder and
  has no `vscode` module. The only exceptions are `shared/cloud-urls.ts` and `shared/vsCodeSelectorUtils.ts`.
```

replace with

```markdown
- `src/eslint.config.mjs` forbids importing `vscode`, or the extension-only folders (`core`, `api`, `services`
  and the like), in `src/shared`, because the webview bundles that folder and has no `vscode` module. There are no
  exceptions.
```

7. `ai_plans/2026-09-27_simplification-roadmap.md`: add a status row for F4 and a new finding F5. The tables are
   wide, so use this script (save it outside the repository, for example `/tmp/f4-roadmap.py`) instead of hand
   edits, then let prettier re-pad the two tables:

```python
import sys
p = sys.argv[1]
lines = open(p).read().split("\n")
out = []
done_r5 = done_f4 = False
for line in lines:
    out.append(line)
    if line.startswith("| R5   | Done  |") and not done_r5:
        out.append("| F4   | Done  | (this PR) | `docs/09-configuration.md` (every environment variable and `tumble-code.*` setting, with reader, default and status) and `docs/10-how-to.md` (setting, tool, provider, webview message). This also covers the variable-table half of D15; the vitest preset remains. |")
        done_r5 = True
    if line.startswith("| F4  |") and not done_f4:
        out.append("| F5  | **Dead or misleading configuration (found while writing F4).** `ROO_CODE_PROVIDER_URL` and the `tumble-code.cloudProviderUrl` setting feed `getRooCodeProviderUrl`, which nothing calls; `ROO_SDK_BASE_URL` (`SDK_BASE_URL`) has no reader; the CLI's `*_BASE_URL` variables are listed in `providerEnvMap` and in `apps/cli/README.md`, but `getBaseUrlFromEnv` has no caller; `AUTHENTIK_APP_SLUG` has no reader in the API; `tumble-code.vsCodeLmModelSelector` is only migrated; `BRIDGE_ENABLED` defaults to `true` in `Settings` but `false` in `docker-compose.yml`; `webview-ui/vite.config.ts` sets `PKG_OUTPUT_CHANNEL` to `Roo-Code`; the header of `src/activate/cloud-urls.ts` names `roo-cline.*` keys. | Delete the dead ones or wire them (the CLI base URLs are documented, so wire those); align the bridge default; fix the comment and the README. Update `docs/09-configuration.md` in the same change. | S |")
        done_f4 = True
assert done_r5 and done_f4, (done_r5, done_f4)
open(p, "w").write("\n".join(out))
```

```sh
python3 /tmp/f4-roadmap.py ai_plans/2026-09-27_simplification-roadmap.md
node_modules/.bin/prettier --write ai_plans/2026-09-27_simplification-roadmap.md
```

   If the assert fails (another WP already reworded the `R5` or `F4` row), add the two rows by hand at the same
   places and run prettier as above. If a later WP already added its own status row after `R5`, put the F4 row
   after the last status row instead.

8. Create `ai_plans/<today as YYYY-MM-DD>_f4-configuration-and-how-to-docs.md` with the text in section 11.

## 7. Tests to add or change

None: documentation only. Instead, run this claims check before committing. Every command must print what is
shown; if one does not, the code changed after this plan was written, and the matching row of the page must be
updated to what the code says now (or stop, see section 12).

```sh
# dead: no non-test caller of these (each prints nothing)
grep -rn "getRooCodeProviderUrl()" --include=*.ts --include=*.tsx src packages apps webview-ui/src | grep -v "__tests__\|\.spec\.\|/dist/\|node_modules"
grep -rn "getBaseUrlFromEnv(" --include=*.ts apps/cli/src | grep -v "__tests__\|export function getBaseUrlFromEnv"
grep -rn "authentik_app_slug" self-hosted-cloudapi/src self-hosted-cloudapi/config/auth.py --include=*.py
# SDK_BASE_URL: only its definition (prints exactly one line, in apps/cli/src/types/constants.ts)
grep -rn "SDK_BASE_URL" --include=*.ts apps/cli/src | grep -v __tests__
# counts quoted by the how-to page (two lines, both 138)
grep -n "toHaveLength(138)" src/core/webview/messageHandlers/__tests__/registry.spec.ts src/core/webview/__tests__/webviewMessageHandler.routing.spec.ts
# compose vs class default of the bridge (prints the two lines)
grep -n "BRIDGE_ENABLED" self-hosted-cloudapi/docker-compose.yml; grep -n "bridge_enabled: bool" self-hosted-cloudapi/config/settings.py
# paths the pages rely on (all exist, no error)
ls src/core/tools/toolArgParsers.ts src/core/tools/toolDescriptors.ts src/core/assistant-message/toolHandlers.ts src/core/prompts/tools/native-tools/examples.ts packages/core/src/message-utils/toolPayload.ts webview-ui/src/utils/extensionBus.ts packages/types/src/__tests__/vscode-extension-host-message-types.spec.ts
# no new environment variable since this plan (compare the list with the page; new names need a row)
grep -rnoE "process\.env(\.[A-Z_a-z0-9]+|\[[^]]+\])" src apps/cli packages webview-ui/src --include=*.ts --include=*.tsx --include=*.mjs | grep -v "__tests__\|\.spec\.\|\.test\.\|/dist/\|__mocks__\|node_modules\|/scripts/" | sed 's/.*process\.env/process.env/' | sort -u
```

The last command prints these 41 entries today (a new one needs a row on the page):
`process.env.AGENT_INTERCHANGE_ALLOW_CROSS_WORKSPACE`, `AGENT_INTERCHANGE_DIR`, `AGENT_INTERCHANGE_TUMBLE_MCP_CONFIG`,
`AGENT_INTERCHANGE_TUMBLE_STORAGE`, `APPDATA`, `CI`, `CLAUDE_CONFIG_DIR`, `CLERK_BASE_URL`, `DEBUG`,
`GLOBAL_AGENT_HTTPS_PROXY`, `GLOBAL_AGENT_HTTP_PROXY`, `GLOBAL_AGENT_NO_PROXY`, `HOME`, `NODE_ENV`,
`NODE_TLS_REJECT_UNAUTHORIZED`, `PKG_NAME`, `PKG_OUTPUT_CHANNEL`, `PKG_SHA`, `PKG_VERSION`, `POSTHOG_API_KEY`,
`POSTHOG_HOST`, `PROGRAMDATA`, `ROO_ASKPASS_SOCKET`, `ROO_ASKPASS_TOKEN`, `ROO_AUTH_BASE_URL`, `ROO_CODE_API_URL`,
`ROO_CODE_DISABLE_TELEMETRY`, `ROO_CODE_PROVIDER_URL`, `ROO_DISABLE_AUTO_MEMORY`, `ROO_LOG_RAW_USAGE`,
`ROO_SDK_BASE_URL`, `ROO_TEST_LOGS`, `SHELL`, `USERPROFILE`, `VITE_PORT`, `XDG_DATA_HOME`, `ZDOTDIR`, and the
computed `process.env[CLI_RUNTIME_ENV.codexAuthOnly]`, `process.env[envVar]`, `process.env[keyLayer.apiKeyEnv]`,
`process.env[name]`.

## 8. Commands to run (exact, from which directory) and the expected result

From the repository root:

```sh
node_modules/.bin/prettier --check docs/09-configuration.md docs/10-how-to.md docs/README.md docs/04-tools-and-providers.md docs/architecture.md ai_plans/2026-09-27_simplification-roadmap.md ai_plans/*_f4-configuration-and-how-to-docs.md
```

Expected: `All matched files use Prettier code style!`

```sh
grep -nP '[^\x00-\x7F]' docs/09-configuration.md docs/10-how-to.md ai_plans/*_f4-configuration-and-how-to-docs.md
```

Expected: no output (ASCII only). Do not run this on the roadmap or `docs/architecture.md`: older lines there may
contain non-ASCII characters that are not yours.

```sh
for f in 06-persistence.md architecture.md 04-tools-and-providers.md 09-configuration.md 10-how-to.md; do test -f docs/$f || echo "missing docs/$f"; done
grep -n "^## Add a native tool$\|^## Add a provider$" docs/10-how-to.md
grep -n "^### Cloud URL precedence$" docs/09-configuration.md
```

Expected: no "missing" line; the two headings (anchors `#add-a-native-tool`, `#add-a-provider` used by
`docs/04-tools-and-providers.md`) and the precedence heading (anchor `#cloud-url-precedence` used inside
`docs/09-configuration.md`) are printed.

```sh
git status --short
```

Expected: only `docs/09-configuration.md` (new), `docs/10-how-to.md` (new), `docs/README.md`,
`docs/04-tools-and-providers.md`, `docs/architecture.md`, `ai_plans/2026-09-27_simplification-roadmap.md` and the
new `ai_plans/..._f4-configuration-and-how-to-docs.md`.

No type check, eslint or unit test run is needed: no code changes. CI still runs everything; the known flakes
(section 9) are unrelated.

## 9. Do not touch / pitfalls

- Do not fix the dead configuration in this WP (no code, no `apps/cli/README.md` change): that is the new item F5.
  The pages describe what the code does today, including what is dead (rule in `docs/README.md`).
- Run prettier only on the files listed in section 8, never on `docs/` as a whole or the repository.
- The roadmap is edited by other WPs too. Keep their rows; only add yours. Prettier re-pads the whole status and
  findings tables, which shows as a large diff of whitespace in those tables; that is expected.
- Keep the new pages free of line numbers, em dashes, arrows and curly quotes (owner's rule; `docs/README.md`).
- Do not rename the headings "Add a native tool", "Add a provider" or "Cloud URL precedence": other text links to
  their anchors.
- Known flaky CI checks, unrelated to docs: F1 `cli-integration` case
  `create-with-session-id-resume-loads-correct-session`; F2 Windows `TaskHistoryStore` "releases per-ID lock tails
  for many unique IDs". See the plan README for how to handle them.
- If WP-D2 merged first, `requestDelaySeconds` has a row in `SETTINGS_DEFAULTS`; nothing on these pages depends on
  that. If a WP added or removed a webview message type, the count 138 in `docs/10-how-to.md` (step 4 and 5 of the
  last recipe) must be updated to the number the claims check prints.

## 10. Acceptance checklist (checkboxes)

- [ ] `docs/09-configuration.md` exists and its SHA-256 matches step 3 (or differs only by rows updated after the
      claims check, which you note in the PR).
- [ ] `docs/10-how-to.md` exists and its SHA-256 matches step 3 (same exception).
- [ ] `docs/README.md` lists both pages in the index table.
- [ ] `docs/04-tools-and-providers.md` names `src/core/tools/toolArgParsers.ts` and links to both recipes.
- [ ] `docs/architecture.md` no longer names the two non-existent exception files.
- [ ] The roadmap has an F4 "Done" status row and a new F5 finding row.
- [ ] `ai_plans/<date>_f4-configuration-and-how-to-docs.md` exists.
- [ ] Claims check (section 7) and all commands of section 8 give the expected output.
- [ ] No other file changed.

## 11. Commit, changeset and PR text

Commit title:

```text
docs: add configuration and how-to pages (F4)
```

Commit body:

```text
docs/09-configuration.md lists every environment variable the extension,
the CLI, the cloud client and the self-hosted cloud API read, with the
reading file and symbol, the default and whether it is live, internal,
test-only or dead, plus the tumble-code.* VS Code settings.

docs/10-how-to.md gives the full file list for adding a setting, a native
tool, a provider and a webview-to-host message, with the specs that pin
each list.

Also: link both from docs/README.md; fix the toolArgParsers path in
docs/04-tools-and-providers.md; drop the two non-existent src/shared
exceptions from docs/architecture.md; mark F4 done and record the dead
configuration as F5 in the simplification roadmap.
```

(End the message with the attribution lines your harness requires.)

Changeset: none (docs only).

`ai_plans/<today as YYYY-MM-DD>_f4-configuration-and-how-to-docs.md`:

```markdown
# F4: configuration table and how-to recipes

Item F4 (and the variable-table half of D15) of `2026-09-27_simplification-roadmap.md`.

## Problem

No page listed the environment variables (cloud URLs alone are spread over five of them, two dead), and adding a
setting, a tool, a provider or a webview message meant following compiler errors across up to 18 files.

## Change

- `docs/09-configuration.md`: every environment variable read by the extension, the CLI, `packages/cloud`,
  `packages/telemetry`, `packages/agent-interchange` and the self-hosted API, with reader, default, purpose and
  status (live, internal, test, dead); build-time values; the `tumble-code.*` VS Code settings; cloud URL
  precedence.
- `docs/10-how-to.md`: four recipes with the file list, the example to copy and the specs that pin each list.
- `docs/README.md` index, a path fix in `docs/04-tools-and-providers.md`, a stale sentence in
  `docs/architecture.md`.
- Roadmap: F4 done; new finding F5 (dead or misleading configuration).

## Tests

Docs only. Every "dead" claim and every count quoted by the pages was checked with the grep commands listed in
the WP (`WP-F4.md`, section 7).
```

PR title: `docs: add configuration and how-to pages (F4)`

PR body outline:

- Summary: the two new pages and what each answers; the three small doc fixes; roadmap F4 done, F5 added.
- Findings worth a follow-up (F5): the dead variables and settings, the `BRIDGE_ENABLED` default mismatch, the
  CLI README promising `*_BASE_URL` overrides that are not read.
- Verification: the claims-check commands and prettier check (paste their output).
- Note: no code change, no changeset.
- End with the attribution line your harness requires.

## 12. If stuck

Stop and report (WP id, step, command, output, expectation) when:

- a claims-check command in section 7 prints something other than stated, and you cannot tell from the code what
  the row should now say;
- the SHA-256 in step 3 differs and comparing with the fenced text does not show why;
- `docs/README.md`, `docs/04-tools-and-providers.md` or `docs/architecture.md` no longer contain the text to find
  in steps 4 to 6 (another change reworded them): report the current text instead of guessing a merge;
- the roadmap script fails and the rows cannot be placed by hand without touching other items' rows.
