/*
 * Extension host channel, debug domain: the webview requests handled by
 * src/core/webview/messageHandlers/debug.ts and the host to view
 * messages of the same domain.
 */

/** Markdown preview, plan review launch and debug diagnostics. */
export type DebugWebviewMessageType =
	| "openMarkdownPreview"
	| "openPlanReview"
	| "openDebugApiHistory"
	| "openDebugUiHistory"
	| "downloadErrorDiagnostics"
