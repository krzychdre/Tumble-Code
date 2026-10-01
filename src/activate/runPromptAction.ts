import * as vscode from "vscode"

import {
	type CodeActionId,
	type CodeActionName,
	type TerminalActionId,
	type TerminalActionPromptType,
	TelemetryEventName,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { ClineProvider } from "../core/webview/ClineProvider"
import { supportPrompt } from "../shared/support-prompt"
import { OrganizationAllowListViolationError } from "../utils/errors"

/**
 * Run an editor or terminal action (explain, fix, improve, add to context, new task) in the
 * visible Tumble Code view: build the support prompt, then either put it into the chat box
 * (the "add to context" actions) or start a task with it.
 */
export async function runPromptAction(
	command: CodeActionId | TerminalActionId,
	promptType: CodeActionName | TerminalActionPromptType,
	params: Record<string, string | any[]>,
): Promise<void> {
	TelemetryService.instance.capture(TelemetryEventName.CODE_ACTION_USED, { actionType: promptType })

	const visibleProvider = await ClineProvider.getInstance()

	if (!visibleProvider) {
		return
	}

	const { customSupportPrompts } = await visibleProvider.getState()
	const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

	if (command === "addToContext" || command === "terminalAddToContext") {
		await visibleProvider.postMessageToWebview({
			type: "invoke",
			invoke: "setChatBoxMessage",
			text: `${prompt}\n\n`,
		})
		await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
		return
	}

	try {
		await visibleProvider.createTask(prompt)
	} catch (error) {
		if (error instanceof OrganizationAllowListViolationError) {
			// VS Code does not show errors thrown from a command handler, so show this one here.
			vscode.window.showErrorMessage(error.message)
		}

		throw error
	}
}
