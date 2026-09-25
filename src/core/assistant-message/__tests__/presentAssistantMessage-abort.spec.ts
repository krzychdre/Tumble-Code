// npx vitest src/core/assistant-message/__tests__/presentAssistantMessage-abort.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"
import { presentAssistantMessage } from "../presentAssistantMessage"

// Mock dependencies
vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn((toolName: string) =>
		["ask_followup_question", "read_file", "write_to_file", "attempt_completion", "use_mcp_tool"].includes(
			toolName,
		),
	),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			capture: vi.fn(),
		},
	},
}))

describe("presentAssistantMessage - abort crash regression (handleError -> say re-throw)", () => {
	let mockTask: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockTask = {
			taskId: "test-task-id",
			instanceId: "test-instance",
			abort: false,
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [],
			userMessageContent: [],
			didCompleteReadingStream: false,
			didRejectTool: false,
			didAlreadyUseTool: false,
			consecutiveMistakeCount: 0,
			clineMessages: [],
			api: {
				getModel: () => ({ id: "test-model", info: {} }),
			},
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			toolRepetitionDetector: {
				check: vi.fn().mockReturnValue({ allowExecution: true }),
			},
			getTaskMode: vi.fn().mockResolvedValue("code"),
			providerRef: {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [], experiments: {} }),
					getMcpHub: () => undefined,
				}),
			},
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] }),
			askSay: {
				ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] }),
				say: vi.fn().mockResolvedValue(undefined),
				supersedePendingAsk: vi.fn(),
			},
		}

		mockTask.pushToolResultToUserContent = vi.fn().mockImplementation((toolResult: any) => {
			const existing = mockTask.userMessageContent.find(
				(block: any) => block.type === "tool_result" && block.tool_use_id === toolResult.tool_use_id,
			)
			if (existing) return false
			mockTask.userMessageContent.push(toolResult)
			return true
		})
	})

	it("does not crash when ask() throws an abort Error and cline.abort is set", async () => {
		// Reproduces the original crash. The real race: presentAssistantMessage
		// enters with abort=false and dispatches the tool; the user aborts
		// DURING the awaited task.ask(), so ask() observes access.abort=true and
		// rejects with the plain abort Error. Before the fix, handleError tried
		// to report it via askSay.say("error"), which re-checks abort and
		// re-throws, crashing the process.
		//
		// We simulate the mid-await abort by flipping the flag inside the ask
		// mock just before rejecting, so the entry guard at the top of
		// presentAssistantMessage does not fire (it already ran with abort=false).
		const toolCallId = "tool_call_abort_1"
		mockTask.abort = false
		mockTask.ask = vi.fn().mockImplementation(async () => {
			mockTask.abort = true // abort arrives during the awaited ask
			throw new Error(`[RooCode#ask] task ${mockTask.taskId}.${mockTask.instanceId} aborted`)
		})
		// If the guard is missing, say() would be reached and (in the real
		// implementation) re-throw the abort. In this mock it just records the
		// call — the regression assertion is that it is NEVER reached.
		mockTask.askSay.say = vi.fn().mockResolvedValue(undefined)

		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId,
				name: "ask_followup_question",
				params: { question: "Which option?", follow_up: [{ text: "A" }] },
				nativeArgs: { question: "Which option?", follow_up: [{ text: "A" }] },
				partial: false,
			},
		]

		// Must not throw.
		await expect(presentAssistantMessage(mockTask)).resolves.toBeUndefined()

		// The key regression guard: handleError must short-circuit on abort and
		// never reach askSay.say("error", ...) — that call is what re-threw.
		const errorSayCalls = (mockTask.askSay.say as any).mock.calls.filter((c: any[]) => c[0] === "error")
		expect(errorSayCalls).toHaveLength(0)
	})

	it("does not crash when say() throws an abort Error and cline.abort is set", async () => {
		// Same chain via the say() abort path: after ask() resolves, the tool
		// calls task.say("user_feedback", ...). The abort arrives during that
		// awaited say(), which throws the abort Error, routing through
		// handleError -> askSay.say again. Mid-await abort simulated as above.
		const toolCallId = "tool_call_abort_2"
		mockTask.abort = false
		mockTask.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "answer", images: [] })
		mockTask.say = vi.fn().mockImplementation(async () => {
			mockTask.abort = true // abort arrives during the awaited say
			throw new Error(`[RooCode#say] task ${mockTask.taskId}.${mockTask.instanceId} aborted`)
		})
		mockTask.askSay.say = vi.fn().mockResolvedValue(undefined)

		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId,
				name: "ask_followup_question",
				params: { question: "Which option?", follow_up: [{ text: "A" }] },
				nativeArgs: { question: "Which option?", follow_up: [{ text: "A" }] },
				partial: false,
			},
		]

		await expect(presentAssistantMessage(mockTask)).resolves.toBeUndefined()

		const errorSayCalls = (mockTask.askSay.say as any).mock.calls.filter((c: any[]) => c[0] === "error")
		expect(errorSayCalls).toHaveLength(0)
	})

	it("still reports non-abort errors via askSay.say('error') when not aborting", async () => {
		// Guard against over-broad suppression: a genuine (non-abort) ask()
		// failure must still surface through handleError -> askSay.say("error").
		const toolCallId = "tool_call_real_err"
		mockTask.abort = false
		mockTask.ask = vi.fn().mockRejectedValue(new Error("genuine network failure"))

		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId,
				name: "ask_followup_question",
				params: { question: "Which option?", follow_up: [{ text: "A" }] },
				nativeArgs: { question: "Which option?", follow_up: [{ text: "A" }] },
				partial: false,
			},
		]

		await expect(presentAssistantMessage(mockTask)).resolves.toBeUndefined()

		const errorSayCalls = (mockTask.askSay.say as any).mock.calls.filter((c: any[]) => c[0] === "error")
		expect(errorSayCalls.length).toBeGreaterThanOrEqual(1)
		expect(errorSayCalls[0][1]).toContain("asking question")
		expect(errorSayCalls[0][1]).toContain("genuine network failure")
	})
})
