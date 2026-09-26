// cd src && ./node_modules/.bin/vitest run core/assistant-message/__tests__/presentAssistantMessage-partial-state.spec.ts

// CORE-R7 step 3: presentAssistantMessage runs once per streamed tool-argument
// chunk. The settings it reads for a partial block (custom modes for the tool
// description) cannot change what a partial block does, so they are read once
// per block while it streams; the complete block always reads them fresh, since
// validation and execution depend on them.

import { describe, it, expect, vi, beforeEach } from "vitest"

import { presentAssistantMessage } from "../presentAssistantMessage"
import { validateToolUse } from "../../tools/validateToolUse"

const handle = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock("../../tools/ExecuteCommandTool", () => ({ executeCommandTool: { handle } }))
vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			capture: vi.fn(),
			captureException: vi.fn(),
			captureEvent: vi.fn(),
		},
	},
}))

function makeTask() {
	let version = 0
	const getState = vi.fn(async () => {
		version++
		return { mode: "code", customModes: [{ slug: `modes-v${version}` }] }
	})

	const task = {
		taskId: "t",
		instanceId: "i",
		abort: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		currentStreamingContentIndex: 0,
		currentStreamingDidCheckpoint: false,
		checkpointSave: vi.fn().mockResolvedValue(undefined),
		assistantMessageContent: [] as any[],
		userMessageContent: [],
		didCompleteReadingStream: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		consecutiveMistakeCount: 0,
		apiConfiguration: { apiProvider: "openai" },
		api: { getModel: () => ({ id: "m", info: {} }) },
		recordToolUsage: vi.fn(),
		recordToolError: vi.fn(),
		toolRepetitionDetector: { check: vi.fn().mockReturnValue({ allowExecution: true }) },
		getTaskMode: vi.fn().mockResolvedValue("code"),
		providerRef: { deref: () => ({ getState }) },
		askSay: { ask: vi.fn(), say: vi.fn().mockResolvedValue(undefined) },
		pushToolResultToUserContent: vi.fn().mockReturnValue(true),
		ensureToolResultSpill: vi.fn().mockResolvedValue(undefined),
	} as any

	/** Streams one chunk of the block with `id` (partial) or finishes it. */
	const present = async (id: string, command: string, partial: boolean) => {
		const index = task.assistantMessageContent.findIndex((block: any) => block.id === id)
		const block = {
			type: "tool_use",
			id,
			name: "execute_command",
			params: { command },
			nativeArgs: partial ? undefined : { command },
			partial,
		}
		if (index === -1) {
			task.assistantMessageContent.push(block)
		} else {
			task.assistantMessageContent[index] = block
		}
		await presentAssistantMessage(task)
	}

	return { task, getState, present }
}

describe("presentAssistantMessage settings reads while a tool call streams (CORE-R7 step 3)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("reads the settings once for the streaming chunks of a block and again for the complete block", async () => {
		const { getState, present, task } = makeTask()

		for (const command of ["l", "ls", "ls -", "ls -l", "ls -la"]) {
			await present("call_1", command, true)
		}
		expect(handle).toHaveBeenCalledTimes(5)
		expect(getState).toHaveBeenCalledTimes(1)

		await present("call_1", "ls -la", false)

		expect(getState).toHaveBeenCalledTimes(2)
		// Validation of the complete block sees the fresh settings, not the streaming copy.
		expect(vi.mocked(validateToolUse)).toHaveBeenCalledTimes(1)
		expect(vi.mocked(validateToolUse).mock.calls[0][2]).toEqual([{ slug: "modes-v2" }])
		// The spill policy is prepared for the complete block only.
		expect(task.ensureToolResultSpill).toHaveBeenCalledTimes(1)
	})

	it("does not carry one block's streaming settings over to the next block", async () => {
		const { getState, present } = makeTask()

		await present("call_1", "ls", true)
		await present("call_1", "ls", false)
		await present("call_2", "pw", true)
		await present("call_2", "pwd", true)

		// call_1 partial, call_1 complete, call_2 partial (read once for both chunks).
		expect(getState).toHaveBeenCalledTimes(3)
	})
})
