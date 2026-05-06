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
