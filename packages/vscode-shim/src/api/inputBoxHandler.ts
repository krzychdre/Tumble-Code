import type { InputBoxOptions } from "../interfaces/workspace.js"

/**
 * Answers a `window.showInputBox` call, or returns undefined for "the user
 * dismissed it".
 */
export type InputBoxHandler = (options: InputBoxOptions) => Promise<string | undefined>

let handler: InputBoxHandler | undefined

/**
 * Lets the host answer input box requests coming from the extension.
 *
 * The CLI registers a prompt in its interface here. Without a handler the shim
 * keeps its old answer of "nothing", which is what a headless run needs: a
 * command that asks for a password then fails instead of waiting for a person
 * who is not watching.
 */
export function setInputBoxHandler(next: InputBoxHandler | undefined): void {
	handler = next
}

export function getInputBoxHandler(): InputBoxHandler | undefined {
	return handler
}
