/*
 * Extension host channel, providerProfiles domain: the webview requests handled by
 * src/core/webview/messageHandlers/providerProfiles.ts and the host to view
 * messages of the same domain.
 */

import type { ProviderSettings } from "../provider-settings.js"

/** Provider profiles and model lists. */
export type ProviderProfilesWebviewMessageType =
	| "requestProviderModels"
	| "lockApiConfigAcrossModes"
	| "cliModeProviderSettings"
	| "assignCurrentApiConfigToModes"
	| "toggleApiConfigPin"
	| "enhancementApiConfigId"
	| "upsertApiConfiguration"
	| "renameApiConfiguration"
	| "loadApiConfiguration"
	| "loadApiConfigurationById"
	| "deleteApiConfiguration"

/** Provider profile and model list replies. */
export type ProviderProfilesExtensionMessageType = "listApiConfig" | "providerModels"

/**
 * Provider settings the CLI resolved from ~/.roo/cli-settings.json, sent once
 * at startup. While set, a mode switch applies `modes[mode] ?? base` instead of
 * the provider profile bound to the mode, and nothing is written to the
 * profile store.
 */
export interface CliModeProviderSettings {
	base: ProviderSettings
	modes: Record<string, ProviderSettings>
}

export interface LanguageModelChatSelector {
	vendor?: string
	family?: string
	version?: string
	id?: string
}
