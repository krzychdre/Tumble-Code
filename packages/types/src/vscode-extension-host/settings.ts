/*
 * Extension host channel, settings domain: the webview requests handled by
 * src/core/webview/messageHandlers/settings.ts and the host to view
 * messages of the same domain.
 */

/** Settings, editor settings, sounds, telemetry, panels and upsells. */
export type SettingsWebviewMessageType =
	| "updateSettings"
	| "selectCustomSound"
	| "resetCustomSound"
	| "importSettings"
	| "exportSettings"
	| "resetState"
	| "openTerminalProfilePicker"
	| "openKeyboardShortcuts"
	| "openExtensionLogs"
	| "updateVSCodeSetting"
	| "getVSCodeSetting"
	| "requestTerminalProfiles"
	| "autoApprovalEnabled"
	| "telemetrySetting"
	| "debugSetting"
	| "focusPanelRequest"
	| "switchTab"
	| "dismissUpsell"
	| "getDismissedUpsells"

/** Replies with editor settings, terminal profiles and dismissed upsells. */
export type SettingsExtensionMessageType = "vsCodeSetting" | "terminalProfiles" | "dismissedUpsells"

export type AudioType = "notification" | "celebration" | "progress_loop"
