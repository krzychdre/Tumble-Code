# CLI cloud sign-in: `tumble auth cloud login|logout|status`

**Status:** done on branch `feat/cli-cloud-login` (not pushed). Stacked on it: `feat/cli-cloud-login-tui`.
**Related plans:** `ai_plans/2026-10-03_11-00_cli-cloud-login-overview.md` (the shared contract of the six branches;
kept on the `feat/client-kind-telemetry` stream), `ai_plans/2026-10-01_22-33_cli-remove-dead-commands.md` (removed the
old, broken `tumble auth login`; those names still fail), `ai_plans/2026-10-02_llm-completion-telemetry-gap.md`.

## Touched

- `packages/types/src/cloud.ts`: `CloudLoginOptions { authRedirect? }`, `isLoopbackAuthRedirect`, `AuthService.login(options?)`.
- `packages/types/src/cli-runtime.ts`: `CLI_RUNTIME_ENV.cloudAuthOnly = "ROO_CLI_CLOUD_AUTH_ONLY"`, `readCliRuntimeEnv().cloudAuthOnly`,
  `CliCloudAuthApi`, `CliCloudAuthStatus`.
- `packages/cloud/src/WebAuthService.ts`, `CloudService.ts`: `login(options?)` uses `options.authRedirect` as `auth_redirect`.
- `src/extension.ts`, new `src/extension/cloudAuthOnly.ts`: cloud-auth-only activation returning `{ getCloudAuth() }`.
- `apps/cli`: `src/commands/auth/cloud.ts` (commands), `src/commands/auth/headless-extension.ts` (bootstrap shared with
  `openai-codex.ts`), `src/lib/auth/loopback-callback.ts` (listener + paste fallback), `src/lib/auth/cloud-api-url.ts`
  (`cloudApiUrl` setting), `src/agent/extension-host.ts` + `src/commands/cli/run.ts` (setting applied before
  `activate()`), `src/commands/cli/doctor.ts` (cloud check uses the setting), `src/main.ts`, `src/types/types.ts`.
- Integration case `apps/cli/scripts/integration/cases/cloud-login-and-telemetry.ts`.
- Docs: `apps/cli/README.md`, `docs/architecture.md`, `docs/08-cloud.md`, `docs/09-environment-variables.md`; changeset
  `.changeset/cli-cloud-login.md`.

## Problem

The CLI runs the real extension bundle, so `CloudService` and the cloud telemetry client already start in a CLI run, but
nobody could sign in: the sign-in ends on a `vscode://` deep link that the shim's `registerUriHandler` drops, the
shim's `env.openExternal` only logs, and the CLI had no way to name the cloud before `activate()` reads
`tumble-code.cloudApiUrl` (the settings the CLI pushes arrive later, with no change event).

## Fix

1. **Loopback redirect.** `login({ authRedirect })` sends `auth_redirect=http://127.0.0.1:<port>` instead of the deep
   link. `isLoopbackAuthRedirect` (the contract's rule: `127.0.0.1`, `localhost` or `[::1]`, port 1024 to 65535,
   nothing after the port) is checked before any state is stored or a browser opened. The cloud API applies the same
   rule (branch `feat/cloudapi-loopback-sign-in`).
2. **Cloud-auth-only activation.** With `ROO_CLI_CLOUD_AUTH_ONLY=1`, `activate()` syncs the cloud URLs, awaits
   `CloudService.createInstance` and returns `{ getCloudAuth: () => CliCloudAuthApi }` with `login(authRedirect)`,
   `handleAuthCallback(code, state, orgId?)`, `logout()`, `getStatus()`, `waitForSettledSession(timeoutMs)`, `dispose()`.
   Nothing else starts (no provider, telemetry, webview, commands). `handleAuthCallback` waits for the auth service to
   reach `attempting-session` (the secrets change is handled asynchronously), so a status read right after it never sees
   the previous session. The normal activation path is unchanged.
3. **Cloud URL.** `cloudApiUrl` in `~/.roo/cli-settings.json`, normalized (trimmed, trailing slashes dropped, http(s)
   only) in one place because the extension keys the stored credentials by this URL. Applied with the shim's
   `setRuntimeConfig("tumble-code", "cloudApiUrl", ...)` before `activate()` by both `ExtensionHost` and the headless
   bootstrap. Without it `TUMBLE_CODE_API_URL` (or `ROO_CODE_API_URL`) applies; with neither, login, logout and status
   print how to set `cloudApiUrl` and start nothing. An invalid setting is a warning in `tumble` runs and an error in
   `tumble auth cloud`.
4. **Same storage.** Headless auth and a normal run both create the shim with no `storageDir`, so both use
   `~/.vscode-mock` (`global-storage/secrets.json`, mode 0600, and `global-state.json` for the sign-in state). Only
   `--ephemeral` uses a temporary directory, so an ephemeral run is always signed out (documented).
5. **Listener.** `startLoopbackListener` binds `127.0.0.1:0`, serves only `GET /auth/clerk/callback` with code and
   state (404 other paths, 405 other methods, 400 without code/state, 409 after the first), accepts only the state of
   the sign-in it started once that is known (a stray or forged request gets an error page and the listener keeps
   waiting), holds the browser's response until the ticket exchange finished (page says signed in or shows the error;
   a neutral page after 30 s), times out after 5 minutes and aborts on Ctrl+C. When stdin is a terminal,
   `waitForPastedCallback` also accepts a pasted callback URL; whichever comes first wins. The sign-in URL is always
   printed and opened with `open-external.ts`.
6. **Commands.** `tumble auth cloud login|logout|status`; exit 0 on success / signed in, 1 otherwise (codex has no
   `--quiet` flag, so none was added). The removed `tumble auth login|logout|status` still fail. `tumble doctor` checks
   the configured cloud and points at `tumble auth cloud status`; showing the sign-in itself would mean booting the
   extension or reading the shim's secrets format, so it does not.
7. **Bootstrap shared with codex.** `activateHeadlessExtension` replaces the copy in `openai-codex.ts`. It now keeps
   the `vscode` module hook installed until `dispose()`: the cloud package requires `vscode` lazily (`importVscode`, on
   `login`), and Node's per-parent resolve cache does not remember a module that was only ever served from
   `require.cache`, so restoring the hook right after `activate()` (as before) made `login` fail with "VS Code API not
   available". Found by the integration case.

### Shim workaround (protected area, not changed)

`packages/vscode-shim/src/classes/Uri.ts` `Uri.parse` builds the authority from `url.hostname`, dropping the port, so
`vscode.env.openExternal(vscode.Uri.parse("http://127.0.0.1:8000/extension/sign-in?..."))` hands the CLI
`http://127.0.0.1/extension/sign-in?...`. `restoreCloudPort` in `cloud-api-url.ts` puts the cloud's port back when the
opened URL is on the cloud's host without a port. Root fix: `url.host` in the shim (needs a dedicated item).

## Telemetry in a signed-in CLI run (traced, then proven end to end)

- `src/extension.ts` normal path: `TelemetryService.createInstance()`, then `TelemetryService.instance.setProvider(provider)`
  with the sidebar `ClineProvider`; the CLI keeps it alive (`ExtensionHost.extensionAPI` holds the `API`, which holds
  the provider). The background cloud start registers `cloudService.telemetryClient`, and `TelemetryService.register`
  hands it the stored provider (the earlier P9 fix), so events carry the app properties.
- `CloudTelemetryClient.capture` -> schema parse -> `fetch` sends while `isAuthenticated()` and a session token exists.
- Proof: the integration case runs `tumble -p` after `tumble auth cloud login` against a fake cloud and asserts that an
  `LLM Completion` event with `editorName` `wrapper|cli|...` reached `POST /api/events`. No CLI-specific gap was found.
  A one-off variant (not committed) behind a TLS proxy that delays every server answer by 800 ms still delivered
  `LLM Completion` and `Tool Used` before the print run exited.

## Security notes

- The listener binds to 127.0.0.1 only, on an OS-chosen port, answers one valid callback and closes; the extension's
  existing state check (CSRF) still decides, the listener's own state filter only stops a stray request from ending
  the wait. Pages escape all text.
- `auth_redirect` is validated on both sides; a non-loopback value never leaves the client.
- Credentials stay in the shim's `secrets.json` (0600), as for the codex OAuth tokens.
- The paste fallback reads stdin in normal line mode (`terminal: false`), so Ctrl+C still raises SIGINT.

## Tests

- `packages/types`: `isLoopbackAuthRedirect` accept/reject table; `cli-runtime.spec.ts` (new key).
- `packages/cloud`: `WebAuthService.spec.ts` (loopback redirect sent; non-loopback refused before state/browser),
  `CloudService.test.ts` (options passed through).
- `src`: `extension/__tests__/cloudAuthOnly.spec.ts` (redirect, status, credential pickup wait, settle/timeout, logout,
  dispose); `__tests__/extension.spec.ts` (cloud-auth-only starts only the cloud, after the URL sync).
- `apps/cli`: `lib/auth/__tests__/loopback-callback.test.ts` (real socket: pass-through, held reply, 404/405/400/409,
  state filter, timeout, abort, paste); `lib/auth/__tests__/cloud-api-url.test.ts`; `commands/auth/__tests__/cloud.test.ts`
  (injected dependencies: login, paste, unconfigured, env source, exchange failure, timeout, unconfirmed session,
  port restore, logout, status); `agent/__tests__/extension-host.test.ts` (setting applied before `activate()`);
  `__tests__/argument-parser.test.ts` (help snapshots, routing, exit codes).
- Integration (real bundle, fake cloud, fake browser on PATH):
  `pnpm --filter @tumble-code/cli test:integration --match cloud-login` passed three times (24 to 28 s).

## Notes

- Events captured before the first session token (state `attempting-session`) are dropped by
  `CloudTelemetryClient.fetch`, as in VS Code; a CLI run reaches `active-session` within one request of the cloud
  start, well before the first model answer.
- `CloudTelemetryClient.shutdown()` does not wait for requests in flight, so a print run that exits while a TLS
  handshake to a slow cloud is still open could lose its last event. Not observed (see above); fix there if it shows.
- `open-external.ts` on Windows passes the URL unquoted to `cmd /c start`, where an `&` in the query likely ends the
  command; the sign-in URL has one. Not verified on Windows; pre-existing (the codex URL has the same shape), and the
  printed URL still works.
- `RefreshTimer` timers are not unref'd, so the auth commands end with `process.exit`, as the codex commands do.
