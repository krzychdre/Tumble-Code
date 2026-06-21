/**
 * Cloud URL configuration module.
 *
 * Reads the Roo Code Cloud URL overrides from VS Code settings and applies
 * them as runtime overrides in the `@roo-code/cloud` package. This allows
 * users to point the extension at a self-hosted or development Cloud API,
 * Provider, and/or Clerk instance.
 *
 * The VS Code settings are:
 *   - `roo-cline.cloudApiUrl`      → overrides `ROO_CODE_API_URL`
 *   - `roo-cline.cloudProviderUrl` → overrides `ROO_CODE_PROVIDER_URL`
 *   - `roo-cline.clerkBaseUrl`     → overrides `CLERK_BASE_URL`
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

import { setRooCodeApiUrl, setRooCodeProviderUrl, setClerkBaseUrl } from "@roo-code/cloud"

import { Package } from "./package"

/**
 * Read the current VS Code configuration values and push them into the
 * `@roo-code/cloud` runtime overrides.  Call this once during activation
 * and again whenever the configuration changes.
 */
export function syncCloudUrls(): void {
	const config = vscode.workspace.getConfiguration(Package.name)

	const cloudApiUrl = config.get<string>("cloudApiUrl")?.trim() || undefined
	const cloudProviderUrl = config.get<string>("cloudProviderUrl")?.trim() || undefined
	const clerkBaseUrl = config.get<string>("clerkBaseUrl")?.trim() || undefined

	setRooCodeApiUrl(cloudApiUrl)
	setRooCodeProviderUrl(cloudProviderUrl)
	setClerkBaseUrl(clerkBaseUrl)
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
				e.affectsConfiguration(`${Package.name}.cloudProviderUrl`) ||
				e.affectsConfiguration(`${Package.name}.clerkBaseUrl`)
			) {
				syncCloudUrls()
			}
		}),
	)
}
