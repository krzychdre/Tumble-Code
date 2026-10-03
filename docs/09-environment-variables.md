# Level 3: environment variables

Every variable the code actually reads, in one table. The source of truth is the code; this page is the map. When you
add or remove a variable, update this page in the same pull request (the rule from `AGENTS.md`).

How to verify a variable is still read: `grep -rn "process.env.NAME" src apps packages` (add `self-hosted-cloudapi`
and `--include="*.py"` for the cloud service). Excluded below: `HOME`/`USERPROFILE`/`APPDATA`/`PROGRAMDATA`/`SHELL`
(standard OS variables read for paths and the default shell), `PATH`, and variables consumed only inside `dist/`
builds.

The same-named VS Code settings take priority over most of the extension variables (see
["Settings versus environment"](#settings-versus-environment) below).

## Extension (runs in VS Code or the CLI host process)

| Variable                                                                       | Read in                                                                                                                                                                               | What it does                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROO_DISABLE_AUTO_MEMORY`                                                      | `src/core/memory/paths.ts`                                                                                                                                                            | `1` forces the built-in memory system off, `0` forces it on; overrides the memory settings. `unset` (empty) leaves the settings in charge.                                                          |
| `ROO_LOG_RAW_USAGE`                                                            | `src/api/providers/openai.ts`, `base-openai-compatible-provider.ts`                                                                                                                   | `1` logs the raw usage object a provider returns (debugging token accounting).                                                                                                                      |
| `ROO_ASKPASS_SOCKET`, `ROO_ASKPASS_TOKEN`                                      | `src/integrations/terminal/askpass/AskpassServer.ts`                                                                                                                                  | Set by the extension on the askpass helper process it spawns; carries the socket path and token for Git credential prompts in integrated terminals. Not for users to set.                           |
| `ROO_ZDOTDIR`                                                                  | `src/integrations/terminal/ShellIntegrationManager.ts`                                                                                                                                | Backup of the original `ZDOTDIR` when the extension redirects zsh startup files for shell integration. Set on child terminals, not by the user.                                                     |
| `ROO_TEST_LOGS`                                                                | `src/utils/logging/index.ts`                                                                                                                                                          | Under tests (`NODE_ENV=test`), `1` turns the real CompactLogger on (off by default so test output stays clean).                                                                                     |
| `NODE_ENV`                                                                     | `src/extension.ts`, `i18n/setup.ts`, `CustomModesManager`, `SkillsManager`, `utils/logging/index.ts`, `core/webview/PlanReviewPanel.ts`, `apps/cli/src/lib/utils/react-production.ts` | `development`/`production` selects dev behaviour (HMR port, i18n reload, hot-reloading custom modes/skills, plan-review dev page, production React builds in the CLI). `test` switches logging off. |
| `VITE_PORT`                                                                    | `src/core/webview/PlanReviewPanel.ts`                                                                                                                                                 | Set by the dev launch config; its presence switches the plan-review panel to the Vite dev server.                                                                                                   |
| `NODE_TLS_REJECT_UNAUTHORIZED`                                                 | `src/utils/networkProxy.ts`                                                                                                                                                           | Temporarily set to `0` while the network proxy is active (global-agent 4.x reads it); the original value is restored afterwards. Do not set globally: it disables TLS verification.                 |
| `GLOBAL_AGENT_HTTP_PROXY`, `GLOBAL_AGENT_HTTPS_PROXY`, `GLOBAL_AGENT_NO_PROXY` | `src/utils/networkProxy.ts`                                                                                                                                                           | Written from the network-proxy setting when the proxy is enabled; global-agent reads them for outbound HTTP(S). Not meant to be set by hand.                                                        |
| `CLERK_BASE_URL`                                                               | `packages/cloud/src/config.ts` (`getClerkBaseUrl`)                                                                                                                                    | Auth (Clerk-compatible facade) base URL. Overridden by the `roo-cline.clerkBaseUrl` setting; auto-detects to the API URL for self-hosted when unset.                                                |
| `TUMBLE_CODE_API_URL`                                                          | `packages/cloud/src/config.ts` (`getTumbleCodeApiUrl`)                                                                                                                                | Cloud API base URL. Overridden by the `roo-cline.cloudApiUrl` setting (the CLI: `cloudApiUrl` in `cli-settings.json`). Defaults to `https://app.tumblecode.dev`.                                    |
| `TUMBLE_CODE_DISABLE_TELEMETRY`                                                | `packages/cloud/src/TelemetryClient.ts`                                                                                                                                               | `1` makes the cloud telemetry client a no-op regardless of settings.                                                                                                                                |
| `PKG_NAME`, `PKG_VERSION`, `PKG_OUTPUT_CHANNEL`, `PKG_SHA`                     | `src/shared/package.ts`, `apps/vscode-nightly/esbuild.mjs`                                                                                                                            | Injected at build time by esbuild `define`, never read from a real environment: the package name/version/output channel/git sha baked into the bundle.                                              |
| `DEBUG`                                                                        | `packages/vscode-shim/src/utils/logger.ts`                                                                                                                                            | Any non-empty value enables the shim's `debug()` log lines (used by the CLI host).                                                                                                                  |
| `ZDOTDIR`                                                                      | `src/integrations/terminal/ShellIntegrationManager.ts`                                                                                                                                | Read (standard zsh variable) to back it up into `ROO_ZDOTDIR` before redirecting.                                                                                                                   |

## CLI runtime contract (`packages/types/src/cli-runtime.ts`)

Seven variables the CLI sets for the extension it hosts. Names come from `CLI_RUNTIME_ENV`; import that constant, never
a string literal. `packages/vscode-shim` still reads two `globalThis` slots by literal name; see
[architecture.md](architecture.md#the-cli-runtime-contract).

| Variable                  | Who sets it                      | What it does                                                                                                                            |
| ------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ROO_CLI_RUNTIME`         | CLI host (`extension-host.ts`)   | `1` marks the process as the CLI runtime (`readCliRuntimeEnv().isCliRuntime`).                                                          |
| `ROO_CLI_CODEX_AUTH_ONLY` | `tumble auth codex login`        | `1` activates only the OpenAI Codex OAuth manager. Restored to its previous value afterwards.                                           |
| `ROO_CLI_CLOUD_AUTH_ONLY` | `tumble auth cloud ...`          | `1` starts only the cloud service and returns the cloud sign-in API (`getCloudAuth`). Restored to its previous value afterwards.        |
| `ROO_CLI_VERSION`         | CLI host                         | The CLI package version; the extension sends it as `clientVersion` with telemetry, error reports and LLM exchanges.                     |
| `ROO_MCP_SETTINGS_PATH`   | CLI host                         | Overrides the global MCP settings file (default `~/.roo/mcp.json`).                                                                     |
| `ROO_CLI_ROOT`            | Release wrapper script / harness | Root of the unpacked CLI release; resolves bundled assets (ripgrep, node_modules). Dev mode falls back to walking up to `package.json`. |
| `ROO_EXTENSION_PATH`      | CLI host                         | Path to the built extension (`src/dist`) the host loads.                                                                                |
| `ROO_RIPGREP_PATH`        | CLI host                         | Path to the bundled ripgrep binary.                                                                                                     |

## CLI provider keys (`apps/cli/src/lib/utils/provider-types.ts`)

The CLI reads `<PROVIDER>_API_KEY` and `<PROVIDER>_BASE_URL` from the environment when neither a flag nor the settings
file (or the mode's override) sets the value; they win over the CLI's own extension state (`getApiKeyFromEnv` /
`getBaseUrlFromEnv`, called from `resolveProviderConfig` in `provider-config.ts`). Key vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (openai and
openai-native), `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `LITELLM_API_KEY`, `DEEPSEEK_API_KEY`, `OLLAMA_API_KEY`
(optional), `MISTRAL_API_KEY`, `MOONSHOT_API_KEY`, `MINIMAX_API_KEY`, `XAI_API_KEY`, `ZAI_API_KEY`. Base-URL vars:
`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `GOOGLE_GEMINI_BASE_URL`, `OPENROUTER_BASE_URL`, `LITELLM_BASE_URL`,
`DEEPSEEK_BASE_URL`, `OLLAMA_BASE_URL`, `LMSTUDIO_BASE_URL`, `AWS_BEDROCK_ENDPOINT`, `MOONSHOT_BASE_URL`,
`MINIMAX_BASE_URL` (mistral has none: the extension uses its custom URL only for Codestral models). Keyless providers (codex, lmstudio, bedrock, vertex, qwen-code) resolve
credentials through OAuth caches, the AWS SDK or gcloud instead; those SDK chains bring their own standard variables
(`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`, ...), which this page does not duplicate.

## Agent interchange (`packages/agent-interchange`)

| Variable                                  | Read in                              | What it does                                                        |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `AGENT_INTERCHANGE_DIR`                   | `src/locate.ts`                      | Overrides the default handoff directory.                            |
| `AGENT_INTERCHANGE_TUMBLE_STORAGE`        | `src/locate.ts`                      | Overrides where the MCP server looks for Tumble sessions.           |
| `AGENT_INTERCHANGE_TUMBLE_MCP_CONFIG`     | `src/install/index.ts`               | Overrides the path of the MCP config fragment to install.           |
| `AGENT_INTERCHANGE_ALLOW_CROSS_WORKSPACE` | `src/mcp/index.ts`                   | `1` lets the MCP tools read sessions outside the current workspace. |
| `CLAUDE_CONFIG_DIR`                       | `src/locate.ts`                      | Where Claude Code keeps its data (default `~/.claude`).             |
| `XDG_DATA_HOME`                           | `src/locate.ts`, `install/config.ts` | Standard XDG override for the data directory.                       |

## Self-hosted cloud API (`self-hosted-cloudapi/config/settings.py`)

Pydantic-settings: every field of `Settings` maps to an uppercased variable. `CLOUDAPI_ENV_FILE` names the env file
(default `.env`; the test suite sets it empty so a developer's `.env` cannot change test results). `extra="ignore"`
lets one `.env` carry the docker-compose infra keys too. Descriptions, defaults and the startup validation rules
(secret length, CORS format, network format) live in `settings.py` only; `.env.example` is the template. The bundled
`docker-compose.yml` passes the optional variables through by name, so an unset one falls back to the `settings.py`
default. It sets values of its own only for `DATABASE_URL` (its Postgres) and `AUTHENTIK_INTERNAL_URL` (the
`auth_server` service), gives the bundled stack's local addresses as fallbacks for the required URLs and client id,
and refuses to start without `SECRET_KEY` and `JWT_SECRET`.

| Variable                                                              | Default                            | What it does                                                                                          |
| --------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                        | required                           | PostgreSQL DSN (SQLite works for smoke tests).                                                        |
| `SECRET_KEY`                                                          | required, min 32 chars             | Signs internal artifacts (state tokens, cookies). Placeholder refused at startup.                     |
| `API_BASE_URL`                                                        | required                           | Public URL of this API.                                                                               |
| `PORT`                                                                | `8085`                             | Listen port.                                                                                          |
| `LOG_LEVEL`                                                           | `INFO`                             | Service log level (DEBUG/INFO/WARNING/ERROR/CRITICAL).                                                |
| `JWT_ALGORITHM` / `JWT_SECRET` / `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | `HS256` / required(HS) / - / -     | JWT signing; RS256 uses the PEM key paths instead of the shared secret.                               |
| `CLIENT_TOKEN_IDLE_DAYS`                                              | `30`                               | Days the extension's token may go unused before expiring; `0` = never.                                |
| `AUTHENTIK_BASE_URL`                                                  | required                           | Front-channel (browser) Authentik URL.                                                                |
| `AUTHENTIK_INTERNAL_URL`                                              | falls back to `AUTHENTIK_BASE_URL` | Back-channel (server-to-server) URL; compose service name inside docker.                              |
| `AUTHENTIK_CLIENT_ID` / `AUTHENTIK_CLIENT_SECRET`                     | `tumble-code` / -                  | OAuth2 client credentials (the blueprint provisions the same values into Authentik).                  |
| `AUTHENTIK_REDIRECT_URI`                                              | required                           | OAuth2 redirect URI.                                                                                  |
| `CORS_ORIGINS`                                                        | empty                              | Extra trusted origins (comma-separated or JSON array); `*` ignored with a warning (DEF-S8).           |
| `WEB_ALLOWED_NETWORKS`                                                | empty (open)                       | IPs/CIDRs allowed to open the web panel.                                                              |
| `WEB_PUBLIC_URL`                                                      | empty                              | Public panel address for other machines; also registers the extra Authentik callback.                 |
| `BRIDGE_ENABLED` / `BRIDGE_PATH`                                      | `true` / `/bridge/socket.io`       | Live remote-control bridge switch and socket.io mount path (min two segments).                        |
| `TELEMETRY_ENABLED`                                                   | `true`                             | `false` = telemetry endpoints accept-and-ignore.                                                      |
| `BACKFILL_MAX_BYTES`                                                  | 50 MiB                             | Largest accepted task backfill upload (413 above).                                                    |
| `ENABLE_TASK_SHARING` / `ALLOW_PUBLIC_TASK_SHARING`                   | `true` / `true`                    | Task sharing at the org-less level / public links.                                                    |
| `RATE_LIMIT_ENABLED` / `RATE_LIMIT_REQUESTS_PER_MINUTE`               | `true` / `60`                      | slowapi per-IP rate limiting.                                                                         |
| `RETENTION_SWEEP_ENABLED` / `RETENTION_SWEEP_HOURS`                   | `true` / `6`                       | Background data-retention sweep.                                                                      |
| `CLOUDAPI_ENV_FILE`                                                   | `.env`                             | Which env file pydantic reads; empty value reads none.                                                |
| `FORWARDED_ALLOW_IPS`                                                 | `127.0.0.1,::1` (uvicorn)          | Which proxy IPs uvicorn trusts for `X-Forwarded-For` (behind a reverse proxy, point it at the proxy). |

The bundled docker-compose stack adds infra-only keys the API ignores: `AUTH_DB_PORT`, `COMPOSE_PORT_HTTP(S)`,
`PG_DB`, `PG_USER`, `AUTH_PG_PASS`, `AUTHENTIK_SECRET_KEY`, `AUTHENTIK_TAG`, `AUTHENTIK_IMAGE`,
`AUTHENTIK_BOOTSTRAP_PASSWORD`, `AUTHENTIK_BOOTSTRAP_EMAIL`, `AUTHENTIK_BOOTSTRAP_TOKEN`. Those configure Authentik
and its Postgres, not the API.

## Tests and tooling

Read by the test harnesses; set in CI, rarely by hand.

| Variable                                                           | Read in                                                 | What it does                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------- |
| `TEST_GREP`, `TEST_FILE`                                           | `apps/vscode-e2e/src/runTest.ts`, `suite/index.ts`      | Filter the e2e suite (grep pattern / file).                |
| `VSCODE_VERSION`                                                   | `apps/vscode-e2e/src/runTest.ts`                        | VS Code version the e2e suite downloads.                   |
| `OPENROUTER_API_KEY`, `ZAI_API_KEY`, `DEEPSEEK_API_KEY`            | `apps/vscode-e2e/src/suite/providers/`, `test-utils.ts` | Real provider keys for the live provider e2e tests.        |
| `AIMOCK_URL`, `AIMOCK_RECORD`                                      | `apps/vscode-e2e/src/suite/providers/`                  | The @copilotkit/aimock mock server (record/replay mode).   |
| `CI`                                                               | `src/vitest.config.ts`                                  | Adjusts vitest when running under CI.                      |
| `GITHUB_ACTIONS`                                                   | `packages/config-vitest/index.js` (`resolveVerbosity`)  | `true` adds the github-actions reporter to src/webview-ui. |
| `ROO_CLI_FAKE_AI_MODULE`                                           | `apps/cli/src/lib/utils/fake-ai-module.ts`              | Integration suite only: runs the CLI on a scripted model.  |
| `VSCODE_TEXTMATE_DEBUG`                                            | `webview-ui/vite.config.ts`                             | Baked into the webview bundle at build time (`define`).    |
| `npm_execpath`                                                     | `scripts/bootstrap.mjs`                                 | Set by the package manager; tells bootstrap pnpm is used.  |
| `BOOTSTRAP_IN_PROGRESS`                                            | `scripts/bootstrap.mjs`                                 | Guards the bootstrap script against re-entry.              |
| `ZAI_API_KEY`, `VLLM_BASE_URL`, `VLLM_API_KEY`, `VLLM_METRICS_URL` | `scripts/agent-bench/`                                  | Keys/endpoints for the cache-probe scripts (Z.ai / vLLM).  |
| `ROO_CLI_ROOT`                                                     | `apps/cli/scripts/integration/`                         | The integration harness points the CLI at a build to test. |

## Removed variables (D15)

- `ROO_CODE_PROVIDER_URL`: removed in D15 together with the `tumble-code.cloudProviderUrl` setting and
  `getTumbleCodeProviderUrl`/`setTumbleCodeProviderUrl` in `packages/cloud/src/config.ts`. The getter had no caller outside
  tests after the cloud proxy provider was removed, so a value could be set but nothing read it.
- `SDK_BASE_URL` / `ROO_SDK_BASE_URL`: removed in D6 together with the old tRPC client (`apps/cli/src/lib/sdk`),
  which was its only reader.

What is left of the cloud URL family: `TUMBLE_CODE_API_URL` and `CLERK_BASE_URL` (extension, overridable by settings).
`POSTHOG_API_KEY` / `POSTHOG_HOST` went with the PostHog telemetry clients. `ROO_AUTH_BASE_URL` went with `tumble auth login` (its sign-in page
`/cli/sign-in` never existed on the self-hosted cloud).

## Settings versus environment

The extension's own configuration lives in VS Code settings (`roo-cline.*`) and profiles, not the environment; the
cloud URLs are the one family where both exist. `src/activate/cloud-urls.ts` pushes the settings into the
`@tumble-code/cloud` runtime overrides, which win over the env vars: setting → env var → production default. The CLI
keeps its config in `~/.roo/cli/cli-settings.json` and per-mode overrides; provider API keys may come from the
environment via the table above when a profile does not carry one.
