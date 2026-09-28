/*
 * Extension host channel, enhanceAndSearch domain: the webview requests handled by
 * src/core/webview/messageHandlers/enhanceAndSearch.ts and the host to view
 * messages of the same domain.
 */

/** Prompt enhancement, system prompt preview and commit or file search. */
export type EnhanceAndSearchWebviewMessageType =
	| "enhancePrompt"
	| "getSystemPrompt"
	| "copySystemPrompt"
	| "searchCommits"
	| "searchFiles"

/** Enhanced prompt, system prompt and search results. */
export type EnhanceAndSearchExtensionMessageType =
	| "enhancedPrompt"
	| "systemPrompt"
	| "commitSearchResults"
	| "fileSearchResults"
