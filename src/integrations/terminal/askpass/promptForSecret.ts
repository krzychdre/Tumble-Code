import * as vscode from "vscode"

import type { AskpassRequest } from "./AskpassServer"

/**
 * Puts an askpass question in front of the user.
 *
 * `showInputBox` is deliberately the only channel used here, because it is the
 * one thing both hosts already have: VS Code opens its own input box, and the
 * CLI's vscode shim routes it to a prompt in the terminal interface. The answer
 * is returned to the caller and goes straight back to the waiting command; it is
 * never sent through `task.say`, so it cannot land in the conversation, in the
 * saved messages or in a request to the model.
 */
export async function promptForSecret(request: AskpassRequest): Promise<string | undefined> {
	const command = request.command.length > 80 ? `${request.command.slice(0, 77)}...` : request.command

	return vscode.window.showInputBox({
		title: `The command needs an answer: ${command}`,
		prompt: request.prompt,
		password: request.isSecret,
		// The question blocks the command, so dismissing it by clicking elsewhere
		// would leave the command waiting with nothing on screen to explain why.
		ignoreFocusOut: true,
	})
}
