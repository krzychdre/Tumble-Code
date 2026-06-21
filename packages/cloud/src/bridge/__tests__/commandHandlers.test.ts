import { describe, it, expect, vi, beforeEach } from "vitest"

import { TaskBridgeCommandName, type TaskBridgeCommand } from "@roo-code/types"

import { dispatchBridgeCommand } from "../commandHandlers.js"
import type { BridgeProvider, BridgeTask } from "../types.js"

function makeTask(): BridgeTask & {
	submitUserMessage: ReturnType<typeof vi.fn>
	handleWebviewAskResponse: ReturnType<typeof vi.fn>
} {
	return {
		taskId: "task-1",
		submitUserMessage: vi.fn(async () => {}),
		handleWebviewAskResponse: vi.fn(),
	}
}

function makeProvider(task: BridgeTask | undefined) {
	const setValue = vi.fn(async () => {})
	const provider: BridgeProvider = {
		getCurrentTask: () => task,
		cancelTask: vi.fn(async () => {}),
		showTaskWithId: vi.fn(async () => undefined),
		postStateToWebview: vi.fn(async () => {}),
		contextProxy: { setValue },
	}
	return { provider, setValue }
}

const ts = 123

describe("dispatchBridgeCommand", () => {
	let task: ReturnType<typeof makeTask>
	let provider: BridgeProvider
	let setValue: ReturnType<typeof vi.fn>

	beforeEach(() => {
		task = makeTask()
		;({ provider, setValue } = makeProvider(task))
	})

	it("message → submitUserMessage with text/images/mode/profile", async () => {
		const cmd: TaskBridgeCommand = {
			type: TaskBridgeCommandName.Message,
			taskId: "task-1",
			payload: { text: "hello", images: ["data:img"], mode: "code", providerProfile: "default" },
			timestamp: ts,
		}
		await dispatchBridgeCommand(cmd, provider)
		expect(task.submitUserMessage).toHaveBeenCalledWith("hello", ["data:img"], "code", "default")
	})

	it("approve_ask → handleWebviewAskResponse('yesButtonClicked', …)", async () => {
		await dispatchBridgeCommand(
			{ type: TaskBridgeCommandName.ApproveAsk, taskId: "task-1", payload: { text: "ok" }, timestamp: ts },
			provider,
		)
		expect(task.handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked", "ok", undefined)
	})

	it("deny_ask → handleWebviewAskResponse('noButtonClicked', …)", async () => {
		await dispatchBridgeCommand(
			{ type: TaskBridgeCommandName.DenyAsk, taskId: "task-1", payload: {}, timestamp: ts },
			provider,
		)
		expect(task.handleWebviewAskResponse).toHaveBeenCalledWith("noButtonClicked", undefined, undefined)
	})

	it("stop_task → provider.cancelTask()", async () => {
		await dispatchBridgeCommand({ type: TaskBridgeCommandName.StopTask, taskId: "task-1", timestamp: ts }, provider)
		expect(provider.cancelTask).toHaveBeenCalledTimes(1)
	})

	it("set_auto_approval → setValue per provided key, then a single postStateToWebview", async () => {
		await dispatchBridgeCommand(
			{
				type: TaskBridgeCommandName.SetAutoApproval,
				taskId: "task-1",
				payload: { autoApprovalEnabled: true, autoApprovalMode: "autonomous", alwaysAllowExecute: false },
				timestamp: ts,
			},
			provider,
		)
		expect(setValue).toHaveBeenCalledWith("autoApprovalEnabled", true)
		expect(setValue).toHaveBeenCalledWith("autoApprovalMode", "autonomous")
		expect(setValue).toHaveBeenCalledWith("alwaysAllowExecute", false)
		// Keys not in the payload must not be touched.
		expect(setValue).toHaveBeenCalledTimes(3)
		expect(provider.postStateToWebview).toHaveBeenCalledTimes(1)
	})

	it("set_auto_approval with empty payload does not push state", async () => {
		await dispatchBridgeCommand(
			{ type: TaskBridgeCommandName.SetAutoApproval, taskId: "task-1", payload: {}, timestamp: ts },
			provider,
		)
		expect(setValue).not.toHaveBeenCalled()
		expect(provider.postStateToWebview).not.toHaveBeenCalled()
	})

	it("resume_task → provider.showTaskWithId(taskId)", async () => {
		await dispatchBridgeCommand(
			{ type: TaskBridgeCommandName.ResumeTask, taskId: "task-hist", timestamp: ts },
			provider,
		)
		expect(provider.showTaskWithId).toHaveBeenCalledWith("task-hist")
	})

	it("live-task commands no-op (no throw) when there is no current task", async () => {
		const { provider: empty } = makeProvider(undefined)
		await expect(
			dispatchBridgeCommand(
				{ type: TaskBridgeCommandName.Message, taskId: "x", payload: { text: "hi" }, timestamp: ts },
				empty,
			),
		).resolves.toBeUndefined()
		await expect(
			dispatchBridgeCommand(
				{ type: TaskBridgeCommandName.ApproveAsk, taskId: "x", payload: {}, timestamp: ts },
				empty,
			),
		).resolves.toBeUndefined()
	})
})
