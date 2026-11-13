# CLI cloud sign-in in the interactive session: `/login`, `/logout`

**Status:** done on branch `feat/cli-cloud-login-tui` (stacked on `feat/cli-cloud-login`, not pushed).
**Related plans:** `ai_plans/2026-10-03_10-22_cli-cloud-login.md` (the loopback listener, the `cloudApiUrl` setting
and `tumble auth cloud`, which this reuses), `ai_plans/2026-10-03_11-00_cli-cloud-login-overview.md` (shared contract).

## Touched

- `packages/types`: `WebviewMessage.authRedirect?` (additive), `ExtensionMessage` type `cloudAuthResult` (additive, in
  `vscode-extension-host/cloudAuth.ts`); the two pinning specs.
- `src/core/webview/messageHandlers/cloudAuth.ts`: `rooCloudSignIn` passes `authRedirect` to `CloudService.login`; the
  sign-in, callback and sign-out handlers wait for the background cloud start and post `cloudAuthResult`.
- `apps/cli/src/agent/extension-host.ts`: `openExternal` option for the shim, `openExternalUrl` event, the `vscode`
  module hook kept until dispose.
- `apps/cli/src/lib/auth/tui-cloud-auth.ts` (new): the `/login` and `/logout` flow.
- `apps/cli/src/lib/utils/commands.ts`, `src/ui/hooks/useTaskSubmit.ts`, `src/ui/hooks/useExtensionHost.ts`,
  `src/ui/App.tsx`: registry, dispatch, autocomplete, URL note, channel.
- Integration: `scripts/integration/cases/tui-cloud-login.ts`, fake cloud moved to `scripts/integration/lib/fake-cloud.ts`.
- Docs: `apps/cli/README.md`, `docs/08-cloud.md`; changeset `.changeset/cli-cloud-login-tui.md`.

## Problem

`tumble auth cloud login` signs in outside a session. Inside one, the user had no way to sign in, and the extension's
sign-in reported nothing visible: the CLI mutes `vscode.window.showErrorMessage` and `showInformationMessage`, and the
shim's `env.openExternal` only logged the sign-in URL.

## Fix

1. **`/login`** (registry entry with argument hint `[address]`, so it is in the slash picker) runs in the background,
   so the prompt stays usable:
    - resolves the cloud like `tumble auth cloud` (settings, then environment; none: explains `cloudApiUrl`);
    - starts the same loopback listener (127.0.0.1, random port, 5 minutes);
    - sends `rooCloudSignIn` with `authRedirect = http://127.0.0.1:<port>`;
    - the extension opens the sign-in page through the host's `openExternal` option: the host emits `openExternalUrl`
      (the TUI notes "Opening your browser. If it does not open, visit: <url>") and opens the browser; the flow reads the
      `state` from that URL so the listener accepts only this sign-in's callback;
    - on the callback it sends `rooCloudManualUrl` with the callback URL (the existing handler: state check, ticket
      exchange, state push), waits for `cloudAuthResult`, answers the waiting browser page and notes the result.
    - From a remote shell: `/login <address the browser ended on>` sends that URL to `rooCloudManualUrl` directly and
      silently ends the waiting browser sign-in. Any other argument prints the usage.
2. **`/logout`** sends `rooCloudSignOut` and notes the `cloudAuthResult`.
3. **Visible results.** The handlers post `cloudAuthResult` (`text` = the request it answers, `success`, `error`);
   `rooCloudSignIn` only on failure (its success is the browser opening). The VS Code webview ignores the message type.
   The footer already follows `cloudIsAuthenticated` from the state push.
4. **Cloud start.** The three handlers `await waitForCloudStart()` (as `handleUri` already does), because a `/login`
   typed right after startup can arrive before the background cloud start finished.
5. **Lazy `vscode` require.** `ExtensionHost` removed its `vscode` module hook right after loading the bundle. The
   cloud package requires `vscode` on sign-in only (`importVscode`), and Node's per-parent resolve cache does not
   remember a module served only from `require.cache`, so `CloudService.login` failed with "VS Code API not available"
   inside the TUI. The hook now stays until `dispose()` (same root cause and fix as the headless bootstrap of branch 1).
6. **Port of the sign-in URL.** The host applies `restoreCloudPort` (branch 1) to every opened URL, because the shim's
   `Uri.parse` drops the port.

Every `openExternal` of the extension in a CLI run now opens the browser and, in the TUI, is shown in the transcript.
Before, it was only logged. Only the cloud sign-in reaches it today.

## Tests

- `src/core/webview/messageHandlers/__tests__/cloudAuth.spec.ts` (new): deep link kept without `authRedirect`,
  loopback passed through, waits for the cloud start, `cloudAuthResult` for start failure, exchange success/failure,
  sign-out success/failure. `webviewMessageHandler.routing.spec.ts` snapshot: the posted `cloudAuthResult` for
  `rooCloudManualUrl` and `rooCloudSignOut` (the `rooCloudSignIn` entry is unchanged).
- `packages/types`: message-type and surface pins.
- `apps/cli/src/lib/auth/__tests__/tui-cloud-auth.test.ts`: full browser round trip over a real socket, exchange
  failure (transcript and page), start failure, unconfigured cloud, timeout, pasted address ending a waiting sign-in,
  usage, unanswered exchange, logout.
- `apps/cli/src/ui/hooks/__tests__/useTaskSubmit.test.tsx`: `/login <address>`, `/logout`, no extension yet; never
  reaches the model.
- `apps/cli/src/ui/hooks/__tests__/useExtensionHost.test.tsx`: URL note, channel subscribe/unsubscribe.
- `apps/cli/src/agent/__tests__/extension-host.test.ts`: lazy `require("vscode")` after activation works until
  dispose; `openExternal` shows and opens the port-restored URL and reports success.
- `apps/cli/src/lib/utils/__tests__/commands.test.ts`: registry and autocomplete.
- Integration: `pnpm --filter @tumble-code/cli test:integration --match cloud` runs both cloud cases;
  `tui-cloud-login` drives the real `ExtensionHost` and bundle with `TuiCloudAuth` against the fake cloud: sign-in
  URL with the cloud port, browser page "signed in", a state push with `cloudIsAuthenticated: true`, logout ending the
  session on the cloud. Passed.

## Notes

- The Ink screen itself was not driven (no pty harness); the case covers everything below it.
- The cloud URL is read once when the CLI starts; after editing `cloudApiUrl` the CLI must be restarted (README).
- Not done: surfacing other muted VS Code notifications in the TUI; that would be a separate, wider decision.
