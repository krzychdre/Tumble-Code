/*
 * Extension host channel, promptsAndModes domain: the webview requests handled by
 * src/core/webview/messageHandlers/promptsAndModes.ts and the host to view
 * messages of the same domain.
 */

/** Mode switching, mode prompts and custom instructions. */
export type PromptsAndModesWebviewMessageType =
	| "customInstructions"
	| "mode"
	| "updatePrompt"
	| "hasOpenedModeSelector"
	| "requestModes"

/** The list of available modes. */
export type PromptsAndModesExtensionMessageType = "modes"
