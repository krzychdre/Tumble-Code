# CLI cloud sign-in and client attribution: overview

**Status:** in progress (four parallel work streams, six branches)
**Related plans:** `ai_plans/archive/2026-06/2026-06-19_finish-self-hosted-auth-flow.md`,
`ai_plans/2026-10-01_22-33_cli-remove-dead-commands.md` (removed the old, broken `tumble auth login`),
`ai_plans/2026-10-02_llm-completion-telemetry-gap.md`

## Goal

1. A CLI user can sign in to the self-hosted Tumble cloud (Authentik behind the cloud API). Signing in is
   optional: without it the CLI sends nothing, exactly like the VS Code extension.
2. While signed in, the CLI sends the same data as the extension: `LLM Completion` events (cost, tokens, model,
   mode), exceptions, error reports and (when enabled) LLM exchanges.
3. The cloud tells the two clients apart: every record carries `clientKind` = `vscode` or `cli`, and the web
   pages can filter and break down by it.

## Why the CLI sends nothing today

The CLI runs the real extension bundle on a fake `vscode` module (`packages/vscode-shim`), so `CloudService`
and the cloud telemetry client already start inside the CLI. Three things stop them from ever being used:

- Sign-in is a `vscode://QUB-IT.tumble-code/auth/clerk/callback` deep link (`WebAuthService.login`). The shim's
  `window.registerUriHandler` discards the handler, so the ticket never reaches the CLI.
- The shim's `env.openExternal` only logs unless the host passes an `openExternal` option, and `ExtensionHost`
  does not pass one.
- The CLI has no way to set `tumble-code.cloudApiUrl` before activation: `syncCloudUrls()` runs early in
  `activate()` and the settings the CLI pushes arrive later, with no change event.

The telemetry client sends only while signed in (`CloudTelemetryClient.fetch` returns early otherwise), so once
sign-in works no further gating is needed.

## Design

### Sign-in: loopback redirect (RFC 8252)

The CLI starts a one-shot HTTP listener on `127.0.0.1:<random port>` and asks the extension to start the normal
sign-in with `auth_redirect=http://127.0.0.1:<port>` instead of the `vscode://` scheme. The cloud API accepts
loopback redirects (new), Authentik is unchanged (its redirect URI is always the API's own callback), and the
browser lands on `http://127.0.0.1:<port>/auth/clerk/callback?code=<ticket>&state=<state>`. The CLI hands that
URL to the extension, which runs the existing `handleAuthCallback` (state check, ticket exchange, credentials in
the shim's `secrets.json`, mode 0600).

Fallback for a remote shell (browser on another machine): the CLI prints the sign-in URL; when the browser
fails to reach the loopback port, the user pastes the address bar URL into the terminal, which the CLI feeds into
the same callback path.

Rejected alternatives: OAuth device grant (new tables, endpoints and a verification page, and Authentik's device
flow is not enabled); a copy-paste-only code page (a 43 character ticket is awkward, and the loopback flow
already covers the paste case).

### Shared contract (all branches)

| Item                            | Value                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Telemetry property              | `clientKind`: `"vscode"` or `"cli"`, plus optional `clientVersion` (CLI package version, CLI only)                        |
| Where it appears                | static app properties of every event, the error report body, the LLM exchange body, backfill `properties`                 |
| Server fallback for old clients | `editorName` starting with `wrapper\|cli` means `cli`, anything else means `vscode`                                       |
| Server column                   | `client_kind` on `telemetry_events`, `error_reports`, `llm_exchanges`, `tasks`                                            |
| Web filter                      | query parameter `client=vscode\|cli` (absent means both), label "Client", values "VS Code" and "CLI"                      |
| Loopback redirect               | `http://127.0.0.1:<port>`, `http://localhost:<port>` or `http://[::1]:<port>`, port 1024 to 65535, nothing after the port |
| Callback path                   | unchanged: `<auth_redirect>/auth/clerk/callback?code=<ticket>&state=<state>`                                              |
| CLI cloud URL                   | `cloudApiUrl` in `~/.roo/cli-settings.json` (env `TUMBLE_CODE_API_URL` still wins over the default)                       |
| CLI commands                    | `tumble auth cloud login`, `tumble auth cloud logout`, `tumble auth cloud status`; TUI `/login`, `/logout`                |

Note: on `/app/diagnostics` the word "source" already means where a problem came from, hence `client`.

## Branches

| Branch                              | Stream          | Content                                                                                                                                                              |
| ----------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat/client-kind-telemetry`        | TS              | `clientKind`/`clientVersion` in the telemetry schemas, `ClineProvider.getAppProperties`, error reports, LLM exchanges; `ROO_CLI_VERSION` in the CLI runtime contract |
| `feat/cloudapi-client-kind`         | Python          | `client_kind` columns + migration with backfill, stamping at ingest, metrics page filter and breakdown                                                               |
| `feat/cloudapi-client-kind-filters` | Python, stacked | `client` filter on diagnostics, task list (plus badge), task detail, dataset export                                                                                  |
| `feat/cloudapi-loopback-sign-in`    | Python          | loopback `auth_redirect` allowed and redirected, CLI wording on the success page                                                                                     |
| `feat/cli-cloud-login`              | TS              | `login(authRedirect)` in the cloud package, cloud-auth-only activation, `tumble auth cloud ...`, loopback listener, `cloudApiUrl` setting                            |
| `feat/cli-cloud-login-tui`          | TS, stacked     | `/login` and `/logout` in the interactive CLI, sign-in URL shown in the transcript                                                                                   |

Each branch carries its own plan document. Merge order: client kind (TS), cloud client kind, its filters,
loopback, CLI login, CLI TUI.

## After merge

- Rebuild the cloud api image (columns, migration, loopback redirect) and the CLI (`apps/cli/scripts/build.sh`).
- The VSIX rebuild is needed only for `clientKind` on events sent from VS Code; until then the server fallback
  classifies them as `vscode`.
