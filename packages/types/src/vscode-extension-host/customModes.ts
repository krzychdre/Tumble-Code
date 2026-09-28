/*
 * Extension host channel, customModes domain: the webview requests handled by
 * src/core/webview/messageHandlers/customModes.ts and the host to view
 * messages of the same domain.
 */

/** Custom modes: edit, delete, import, export and rules folders. */
export type CustomModesWebviewMessageType =
	| "openCustomModesSettings"
	| "updateCustomMode"
	| "deleteCustomMode"
	| "exportMode"
	| "importMode"
	| "checkRulesDirectory"

/** Custom mode import, export, rules folder and delete check replies. */
export type CustomModesExtensionMessageType =
	| "exportModeResult"
	| "importModeResult"
	| "checkRulesDirectoryResult"
	| "deleteCustomModeCheck"
