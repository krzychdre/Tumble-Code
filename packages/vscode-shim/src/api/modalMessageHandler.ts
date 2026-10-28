/**
 * A modal question from the extension: `window.showWarningMessage(message,
 * { modal: true, detail }, ...items)` and its information and error siblings.
 */
export interface ModalMessage {
	severity: "info" | "warning" | "error"
	message: string
	detail?: string
	/** The answers offered; the handler returns one of them, or undefined for "dismissed". */
	items: string[]
}

export type ModalMessageHandler = (question: ModalMessage) => Promise<string | undefined>

let handler: ModalMessageHandler | undefined

/**
 * Lets the host answer the extension's modal questions.
 *
 * The CLI registers a prompt in its interface here. Without a handler a modal
 * question resolves to undefined, "dismissed", which is the safe answer for a
 * headless run: a question such as "start these servers?" is then a no.
 */
export function setModalMessageHandler(next: ModalMessageHandler | undefined): void {
	handler = next
}

export function getModalMessageHandler(): ModalMessageHandler | undefined {
	return handler
}
