import { useEffect } from "react"

import { setInputBoxHandler } from "@roo-code/vscode-shim"

import { useSecretPromptStore } from "../stores/secretPromptStore.js"

/**
 * A command with no terminal of its own (git asking for a password, ssh for a
 * key passphrase) reaches the user through `window.showInputBox` in the core.
 * Registering a handler is what turns that call into a prompt here instead of
 * the shim's default "no answer"; unregistering on unmount releases anything
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

		return () => {
			setInputBoxHandler(undefined)
			useSecretPromptStore.getState().cancelAll()
		}
	}, [])
}
