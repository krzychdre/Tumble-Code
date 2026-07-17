import { TaskBridgeCommandName, type TaskBridgeCommand, type AutoApprovalSettings } from "@roo-code/types"

import type { BridgeProvider } from "./types.js"

/**
 * The auto-approval keys the web cockpit can steer. Each maps 1:1 to a
 * GlobalSettings key the extension stores via `contextProxy.setValue`.
 */
const AUTO_APPROVAL_KEYS: (keyof AutoApprovalSettings)[] = [
	"autoApprovalEnabled",
	"autoApprovalMode",
	"alwaysAllowReadOnly",
	"alwaysAllowWrite",
	"alwaysAllowExecute",
	"alwaysAllowMcp",
	"alwaysAllowModeSwitch",
	"alwaysAllowSubtasks",
	"alwaysApprovePlan",
]

async function applyAutoApproval(payload: AutoApprovalSettings, provider: BridgeProvider): Promise<void> {
	let changed = false
	for (const key of AUTO_APPROVAL_KEYS) {
		const value = payload[key]
		if (value !== undefined) {
			await provider.contextProxy.setValue(key, value)
			changed = true
		}
	}
	// Push state once so the VS Code panel reflects the change the web made.
	if (changed) {
		await provider.postStateToWebview()
	}
}

/**
 * Map a single browser-issued `TaskBridgeCommand` to the verified extension
 * control entry points. Pure dispatch — the orchestrator validates the command
 * shape before calling this, so each branch can trust its payload.
 *
 * Commands that act on the live task no-op when there is no current task (e.g.
 * the user closed it); `resume_task` reopens one by id regardless.
 */
export async function dispatchBridgeCommand(command: TaskBridgeCommand, provider: BridgeProvider): Promise<void> {
	switch (command.type) {
		case TaskBridgeCommandName.Message: {
			const task = provider.getCurrentTask()
			if (!task) return
			await task.submitUserMessage(
				command.payload.text,
				command.payload.images,
				command.payload.mode,
				command.payload.providerProfile,
			)
			return
		}
		case TaskBridgeCommandName.ApproveAsk: {
			const task = provider.getCurrentTask()
			if (!task) return
			task.handleWebviewAskResponse("yesButtonClicked", command.payload.text, command.payload.images)
			return
		}
		case TaskBridgeCommandName.DenyAsk: {
			const task = provider.getCurrentTask()
			if (!task) return
			task.handleWebviewAskResponse("noButtonClicked", command.payload.text, command.payload.images)
			return
		}
		case TaskBridgeCommandName.StopTask: {
			await provider.cancelTask()
			return
		}
		case TaskBridgeCommandName.SetAutoApproval: {
			await applyAutoApproval(command.payload, provider)
			return
		}
		case TaskBridgeCommandName.ResumeTask: {
			await provider.showTaskWithId(command.taskId)
			return
		}
	}
}
