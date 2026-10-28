import { useEffect } from "react"

import { setInputBoxHandler, setModalMessageHandler, type ModalMessage } from "@tumble-code/vscode-shim"

import { useSecretPromptStore } from "../stores/secretPromptStore.js"

/** The offered answer the user typed: its number, or its text in any case; undefined for anything else. */
export function pickModalAnswer(items: string[], typed: string | undefined): string | undefined {
	const answer = typed?.trim().toLowerCase()
	if (!answer) {
		return undefined
	}
	const index = Number(answer)
	if (Number.isInteger(index) && index >= 1 && index <= items.length) {
		return items[index - 1]
	}
	return items.find((item) => item.toLowerCase() === answer)
}

/**
 * Asks one of the extension's modal questions ("start these project MCP
 * servers?") in the prompt dialog, the answers numbered. Anything but one of
 * them, and esc, is "dismissed".
 */
export async function askModalQuestion(question: ModalMessage): Promise<string | undefined> {
	const choices = question.items.map((item, index) => `${index + 1} = ${item}`).join(", ")
	const typed = await useSecretPromptStore.getState().ask({
		prompt: [question.message, question.detail, `Type ${choices}`].filter(Boolean).join("\n"),
		masked: false,
	})
	return pickModalAnswer(question.items, typed)
}

/**
 * A command with no terminal of its own (git asking for a password, ssh for a
 * key passphrase) reaches the user through `window.showInputBox` in the core,
 * and a modal question of the core through `window.show*Message`.
 * Registering the handlers is what turns those calls into a prompt here instead
 * of the shim's default "no answer"; unregistering on unmount releases anything
 * still waiting so the command fails rather than hanging on a dead interface.
 */
export function useSecretPromptBridge(): void {
	useEffect(() => {
		setInputBoxHandler(async (options) =>
			useSecretPromptStore.getState().ask({
				title: options.title,
				prompt: options.prompt ?? "",
				masked: options.password !== false,
			}),
		)
		setModalMessageHandler(askModalQuestion)

		return () => {
			setInputBoxHandler(undefined)
			setModalMessageHandler(undefined)
			useSecretPromptStore.getState().cancelAll()
		}
	}, [])
}
