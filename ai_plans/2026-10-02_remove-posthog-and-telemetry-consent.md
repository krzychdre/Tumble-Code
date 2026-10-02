# Remove PostHog and the telemetry consent setting

Date: 2026-10-02
Branch: `fix/remove-posthog-telemetry-setting` (stacked on `fix/about-remove-upstream-community`)

## Why

Owner decision 2026-10-02: no third-party analytics; while signed in to the Tumble cloud
everything goes there as before; when not signed in nothing is sent; the consent mechanism goes.

State before the change (verified in code):

- `PostHogTelemetryClient` (extension) needed `POSTHOG_API_KEY`; builds have none, so its
  constructor threw and the catch in `extension.ts` swallowed it. Dead in practice.
- webview `TelemetryClient` loaded posthog-js with `api_host: "https://ph.roocode.com"`
  (upstream Roo). Inert without a key, but any build with a key would ship UI events to Roo.
- The "Allow anonymous error and usage reporting" checkbox (`telemetrySetting`) gated only
  those two PostHog clients. `CloudTelemetryClient.updateTelemetryState` was a no-op, so the
  only live sink (cloud `/api/events`, signed-in only) ignored the checkbox entirely.
- `PRIVACY.md` claimed telemetry was opt-in and off by default; the code treated "unset" as opted in.

## Change

- Deleted `PostHogTelemetryClient`, `errorReporting.ts` (PostHog-only error filtering), the
  webview `TelemetryClient`, `TelemetryBanner`, all webview `telemetryClient.capture` call sites.
- Removed `telemetrySetting` (types, defaults, state, Save buffer, host handler, webview
  message type), `TELEMETRY_SETTINGS_CHANGED`, `updateTelemetryState` on every client
  interface, `telemetryKey` / `machineId` in the webview state, the dev-only
  `hmrAnalyticsOrigins` CSP option (`*.posthog.com`).
- `shouldShowAnnouncement` no longer waits for the consent answer.
- Deps: `posthog-node`, `posthog-js`, `@types/vscode` (telemetry pkg) removed; lockfile updated.
- Docs: env-var table, extension-host flowchart, `.env.sample`, publish workflow step,
  `PRIVACY.md` telemetry paragraph rewritten to describe what the cloud client really sends.
- `TelemetryService.captureException` is kept; the cloud client still drops exceptions
  (unchanged behaviour). Hook point for a future diagnostics page.

Off switches that remain: sign out, `ROO_CODE_DISABLE_TELEMETRY=1`, server `TELEMETRY_ENABLED=false`.
