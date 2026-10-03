/*
 * Extension host channel, debug domain: the webview requests handled by
 * src/core/webview/messageHandlers/debug.ts and the host to view
 * messages of the same domain.
 */

/** Markdown preview, plan review launch, debug diagnostics and a window reload. */
export type DebugWebviewMessageType =
	| "openMarkdownPreview"
	| "openPlanReview"
	| "openDebugApiHistory"
	| "openDebugUiHistory"
	| "downloadErrorDiagnostics"
	| "reloadWindow"
