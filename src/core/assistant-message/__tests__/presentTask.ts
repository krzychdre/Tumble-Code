// The task presentAssistantMessage works on, as the dispatch specs need it: every field it reads,
// fake ask/say, a provider with plain settings, and a pushToolResultToUserContent that keeps one
// result per tool_use_id like Task does. A spec passes only what it changes.

import { vi } from "vitest"

export function makePresentTask(overrides: Record<string, unknown> = {}): any {
	const task: any = {
		taskId: "test-task-id",
		instanceId: "test-instance",
		cwd: "/test/workspace",
		abort: false,
		abandoned: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		currentStreamingContentIndex: 0,
		currentStreamingDidCheckpoint: false,
		assistantMessageContent: [],
		userMessageContent: [],
		didCompleteReadingStream: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		consecutiveMistakeCount: 0,
		consecutiveMistakeLimit: 3,
		clineMessages: [],
		apiConfiguration: {},
		api: { getModel: () => ({ id: "test-model", info: {} }) },
		recordToolUsage: vi.fn(),
		recordToolError: vi.fn(),
		toolRepetitionDetector: { check: vi.fn().mockReturnValue({ allowExecution: true }) },
		getTaskMode: vi.fn().mockResolvedValue("code"),
		checkpointSave: vi.fn().mockResolvedValue(undefined),
		providerRef: {
			deref: () => ({
				getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [] }),
				getMcpHub: () => undefined,
			}),
		},
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		askSay: {
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			say: vi.fn().mockResolvedValue(undefined),
		},
		...overrides,
	}
	task.pushToolResultToUserContent ??= vi.fn((result: { type: string; tool_use_id: string }) => {
		const answered = task.userMessageContent.some(
			(block: { type: string; tool_use_id?: string }) =>
				block.type === "tool_result" && block.tool_use_id === result.tool_use_id,
		)
		if (answered) return false
		task.userMessageContent.push(result)
		return true
	})
	return task
}
