/*
 * Extension host channel, messageEdits domain: the webview requests handled by
 * src/core/webview/messageHandlers/messageEdits.ts and the host to view
 * messages of the same domain.
 */

/** Deleting and editing chat messages. */
export type MessageEditsWebviewMessageType =
	| "deleteMessage"
	| "submitEditedMessage"
	| "deleteMessageConfirm"
	| "editMessageConfirm"

/** Confirmation dialogs for deleting and editing chat messages. */
export type MessageEditsExtensionMessageType = "showDeleteMessageDialog" | "showEditMessageDialog"
