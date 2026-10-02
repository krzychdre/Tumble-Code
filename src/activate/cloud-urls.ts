/**
 * Cloud URL configuration module.
 *
 * Reads the Roo Code Cloud URL overrides from VS Code settings and applies
 * them as runtime overrides in the `@tumble-code/cloud` package. This allows
 * users to point the extension at a self-hosted or development Cloud API
 * and/or Clerk instance.
 *
 * The VS Code settings are:
 *   - `roo-cline.cloudApiUrl`         → overrides `ROO_CODE_API_URL`
 *   - `roo-cline.clerkBaseUrl`        → overrides `CLERK_BASE_URL`
 *   - `roo-cline.bridgeRetryDelayMs`  → re-arms the remote-control bridge
 *                                       after socket.io `reconnect_failed`
 *
 * Empty strings are treated as "not set" so the defaults still apply.
 *
 * Auto-detect behavior for self-hosted deployments:
 * When `clerkBaseUrl` is not explicitly configured but `cloudApiUrl` IS
 * configured (pointing to a self-hosted instance), the Clerk base URL is
 * automatically set to the same URL as `cloudApiUrl`. This is because
 * self-hosted deployments serve Clerk-compatible auth endpoints
 * (`/v1/client/sign_ins`, etc.) on the same API server. Without this
 * auto-detect, the extension would send auth tickets to the production
 * Clerk, which has no knowledge of self-hosted users/sessions, causing
 * an HTTP 400 error.
 */

import * as vscode from "vscode"

import { setTumbleCodeApiUrl, setClerkBaseUrl } from "@tumble-code/cloud"

import { Package } from "../shared/package"

/**
 * Read the current VS Code configuration values and push them into the
 * `@tumble-code/cloud` runtime overrides.  Call this once during activation
 * and again whenever the configuration changes.
 */
export function syncCloudUrls(): void {
	const config = vscode.workspace.getConfiguration(Package.name)

	const cloudApiUrl = config.get<string>("cloudApiUrl")?.trim() || undefined
	const clerkBaseUrl = config.get<string>("clerkBaseUrl")?.trim() || undefined

	setTumbleCodeApiUrl(cloudApiUrl)
	setClerkBaseUrl(clerkBaseUrl)
}

/**
 * Bridge re-arm delay after socket.io gives up reconnecting (R11). Read live
 * (not cached) so `bridge.ts` picks up setting changes on the next (re)start;
 * `0` or negative keeps the old give-up behaviour.
 */
export function getBridgeRetryDelayMs(): number {
	const raw = vscode.workspace.getConfiguration(Package.name).get<number>("bridgeRetryDelayMs")
	return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0
}

/**
 * Register a VS Code configuration-change listener that keeps the cloud URL
 * overrides in sync whenever the user changes a setting.
 *
 * Returns a disposable that should be added to `context.subscriptions`.
 */
export function registerCloudUrlsSubscription(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (
				e.affectsConfiguration(`${Package.name}.cloudApiUrl`) ||
				e.affectsConfiguration(`${Package.name}.clerkBaseUrl`) ||
				e.affectsConfiguration(`${Package.name}.bridgeRetryDelayMs`)
			) {
				syncCloudUrls()
			}
		}),
	)
}
