import { RooCodeEventName, TodoItem } from "@roo-code/types"

import { AttemptCompletionToolUse } from "../../../shared/tools"

// Mock the formatResponse module before importing the tool
vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Error: ${msg}`),
		toolResult: vi.fn((msg: string) => `Result: ${msg}`),
		toolDenied: vi.fn(() => "Denied"),
	},
}))

const { mockCaptureTaskCompleted } = vi.hoisted(() => ({
	mockCaptureTaskCompleted: vi.fn(),
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureTaskCompleted: mockCaptureTaskCompleted,
		},
	},
}))

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
		})),
	},
}))

// Mock Package module
vi.mock("../../../shared/package", () => ({
	Package: {
		name: "tumble-code",
	},
}))

import { attemptCompletionTool, AttemptCompletionCallbacks } from "../AttemptCompletionTool"
import { Task } from "../../task/Task"
import * as vscode from "vscode"

describe("attemptCompletionTool", () => {
	let mockTask: Partial<Task>
	let mockPushToolResult: ReturnType<typeof vi.fn>
	let mockAskApproval: ReturnType<typeof vi.fn>
	let mockHandleError: ReturnType<typeof vi.fn>
	let mockToolDescription: ReturnType<typeof vi.fn>
	let mockAskFinishSubTaskApproval: ReturnType<typeof vi.fn>
	let mockGetConfiguration: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockCaptureTaskCompleted.mockReset()
		mockPushToolResult = vi.fn()
		mockAskApproval = vi.fn()
		mockHandleError = vi.fn()
		mockToolDescription = vi.fn()
		mockAskFinishSubTaskApproval = vi.fn()
		mockGetConfiguration = vi.fn(() => ({
			get: vi.fn((key: string, defaultValue: any) => {
				if (key === "preventCompletionWithOpenTodos") {
					return defaultValue // Default to false unless overridden in test
				}
				return defaultValue
			}),
		}))

		// Setup vscode mock
		vi.mocked(vscode.workspace.getConfiguration).mockImplementation(mockGetConfiguration)

		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			todoList: undefined,
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] }),
			emitFinalTokenUsageUpdate: vi.fn(),
			emit: vi.fn(),
			getTokenUsage: vi.fn().mockReturnValue({}),
			toolUsage: {},
			taskId: "task_1",
			apiConfiguration: { apiProvider: "test" } as any,
			api: { getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }) } as any,
		}
	})

	describe("todo list validation", () => {
		it("should allow completion when there is no todo list", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			mockTask.todoList = undefined

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should not call pushToolResult with an error for empty todo list
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should allow completion when todo list is empty", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			mockTask.todoList = []

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should allow completion when all todos are completed", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const completedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "completed" },
			]

			mockTask.todoList = completedTodos

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should prevent completion when there are pending todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should prevent completion when there are in-progress todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithInProgress: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "in_progress" },
			]

			mockTask.todoList = todosWithInProgress

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should prevent completion when there are mixed incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const mixedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
				{ id: "3", content: "Third task", status: "in_progress" },
			]

			mockTask.todoList = mixedTodos

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should allow completion when setting is disabled even with incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Ensure the setting is disabled (default behavior)
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return false // Setting is disabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should not prevent completion when setting is disabled
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should prevent completion when setting is enabled with incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Enable the setting
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should prevent completion when setting is enabled and there are incomplete todos
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should allow completion when setting is enabled but all todos are completed", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const completedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "completed" },
			]

			mockTask.todoList = completedTodos

			// Enable the setting
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should allow completion when setting is enabled but all todos are completed
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		describe("tool failure guardrail", () => {
			it("should prevent completion when a previous tool failed in the current turn", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Task completed successfully" },
					nativeArgs: { result: "Task completed successfully" },
					partial: false,
				}

				mockTask.todoList = undefined
				mockTask.didToolFailInCurrentTurn = true

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				const mockSay = vi.fn()
				mockTask.say = mockSay

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockSay).toHaveBeenCalledWith(
					"error",
					expect.stringContaining("errors.attempt_completion_tool_failed"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("errors.attempt_completion_tool_failed"),
				)
			})

			it("should allow completion when no tools failed", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Task completed successfully" },
					nativeArgs: { result: "Task completed successfully" },
					partial: false,
				}

				mockTask.todoList = undefined
				mockTask.didToolFailInCurrentTurn = false

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.consecutiveMistakeCount).toBe(0)
				expect(mockTask.recordToolError).not.toHaveBeenCalled()
			})
		})

		describe("completion lifecycle", () => {
			it("emits TaskCompleted only when completion is accepted", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "2" },
					nativeArgs: { result: "2" },
					partial: false,
				}

				mockTask.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] })

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockHandleError).not.toHaveBeenCalled()
				expect(mockCaptureTaskCompleted).toHaveBeenCalledWith("task_1")
				expect(mockTask.emit).toHaveBeenCalledWith(
					RooCodeEventName.TaskCompleted,
					"task_1",
					expect.anything(),
					expect.anything(),
				)
			})

			describe("partial-stream / execute handoff", () => {
				it("does not emit a duplicate completion_result when handlePartial saw a command param", async () => {
					const resultText = "All done. See command output."
					const commandText = "echo hello"

					// Track messages the way Task would
					const clineMessages: any[] = []
					mockTask.clineMessages = clineMessages

					mockTask.say = vi.fn(async (type: string, text?: string, _images?: any, partial?: boolean) => {
						const lastMessage = clineMessages.at(-1)
						if (partial === true) {
							if (lastMessage?.type === "say" && lastMessage.say === type && lastMessage.partial) {
								lastMessage.text = text ?? ""
							} else {
								clineMessages.push({ type: "say", say: type, text: text ?? "", partial: true })
							}
						} else if (partial === false) {
							if (lastMessage?.type === "say" && lastMessage.say === type && lastMessage.partial) {
								lastMessage.text = text ?? ""
								lastMessage.partial = false
							} else {
								clineMessages.push({ type: "say", say: type, text: text ?? "", partial: false })
							}
						} else {
							clineMessages.push({ type: "say", say: type, text: text ?? "" })
						}
					}) as any

					mockTask.ask = vi.fn(async (type: string, text?: string, partial?: boolean) => {
						const lastMessage = clineMessages.at(-1)
						if (partial === true) {
							if (lastMessage?.type === "ask" && lastMessage.ask === type && lastMessage.partial) {
								lastMessage.text = text ?? ""
							} else {
								clineMessages.push({ type: "ask", ask: type, text: text ?? "", partial: true })
							}
							return { response: "yesButtonClicked", text: "", images: [] }
						}
						if (partial === false) {
							if (lastMessage?.type === "ask" && lastMessage.ask === type && lastMessage.partial) {
								lastMessage.text = text ?? ""
								lastMessage.partial = false
							} else {
								clineMessages.push({ type: "ask", ask: type, text: text ?? "", partial: false })
							}
						}
						return { response: "yesButtonClicked", text: "", images: [] }
					}) as any

					const callbacks: AttemptCompletionCallbacks = {
						askApproval: mockAskApproval,
						handleError: mockHandleError,
						pushToolResult: mockPushToolResult,
						askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
						toolDescription: mockToolDescription,
					}

					// First partial: result + command starting to stream
					const partial1 = {
						type: "tool_use",
						name: "attempt_completion",
						params: { result: resultText, command: commandText } as any,
						nativeArgs: { result: resultText },
						partial: true,
					} as AttemptCompletionToolUse
					await attemptCompletionTool.handle(mockTask as Task, partial1, callbacks)

					// Second partial: command continues streaming
					const partial2 = {
						type: "tool_use",
						name: "attempt_completion",
						params: { result: resultText, command: commandText + " world" } as any,
						nativeArgs: { result: resultText },
						partial: true,
					} as AttemptCompletionToolUse
					await attemptCompletionTool.handle(mockTask as Task, partial2, callbacks)

					// Final: execute() with full result
					const final = {
						type: "tool_use",
						name: "attempt_completion",
						params: { result: resultText, command: commandText + " world" } as any,
						nativeArgs: { result: resultText },
						partial: false,
					} as AttemptCompletionToolUse
					await attemptCompletionTool.handle(mockTask as Task, final, callbacks)

					const finalizedCompletionSays = clineMessages.filter(
						(m) => m.type === "say" && m.say === "completion_result" && m.partial !== true,
					)
					expect(finalizedCompletionSays).toHaveLength(1)
					expect(finalizedCompletionSays[0].text).toBe(resultText)
				})
			})

			it("does not emit TaskCompleted when user provides follow-up feedback", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "2" },
					nativeArgs: { result: "2" },
					partial: false,
				}

				mockTask.ask = vi.fn().mockResolvedValue({
					response: "messageResponse",
					text: "Different question now: what is 3+3?",
					images: [],
				})

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockHandleError).not.toHaveBeenCalled()
				expect(mockCaptureTaskCompleted).not.toHaveBeenCalled()
				expect(mockTask.emit).not.toHaveBeenCalledWith(
					RooCodeEventName.TaskCompleted,
					expect.anything(),
					expect.anything(),
					expect.anything(),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("<user_message>"))
			})
		})
	})

	// Regression coverage for the delegation gate: a delegated subtask must return its
	// result to the parent (reopenParentFromDelegation) rather than finalize the whole task
	// (ask("completion_result")). The gate keys on the durable `awaitingChildId` signal so a
	// background-drain save that clobbers the parent status "delegated" -> "active" does not
	// break the return. See ai_plans/2026-06-08_delegated-subtask-no-return.md.
	describe("subtask delegation gate", () => {
		const CHILD_ID = "task_1"
		const PARENT_ID = "parent_1"

		let mockGetTaskWithId: ReturnType<typeof vi.fn>
		let mockReopenParentFromDelegation: ReturnType<typeof vi.fn>

		const setupDelegation = (parentHistory: { status?: string; awaitingChildId?: string }) => {
			mockGetTaskWithId = vi.fn(async (id: string) => {
				if (id === CHILD_ID) {
					return { historyItem: { id: CHILD_ID, status: "active" } }
				}
				return { historyItem: { id: PARENT_ID, ...parentHistory } }
			})
			mockReopenParentFromDelegation = vi.fn().mockResolvedValue(true)
			;(mockTask as any).parentTaskId = PARENT_ID
			mockTask.clineMessages = []
			mockTask.didToolFailInCurrentTurn = false
			mockTask.providerRef = {
				deref: () => ({
					getTaskWithId: mockGetTaskWithId,
					reopenParentFromDelegation: mockReopenParentFromDelegation,
				}),
			} as any

			// approve the finish-subtask gate so the delegation branch can proceed
			mockAskFinishSubTaskApproval.mockResolvedValue(true)

			return {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "child done" },
				nativeArgs: { result: "child done" },
				partial: false,
			} as AttemptCompletionToolUse
		}

		const callbacks = (): AttemptCompletionCallbacks => ({
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
			toolDescription: mockToolDescription,
		})

		it("returns to parent when parent is still delegated and awaiting this child", async () => {
			const block = setupDelegation({ status: "delegated", awaitingChildId: CHILD_ID })

			await attemptCompletionTool.handle(mockTask as Task, block, callbacks())

			expect(mockReopenParentFromDelegation).toHaveBeenCalledWith(
				expect.objectContaining({ parentTaskId: PARENT_ID, childTaskId: CHILD_ID }),
			)
			// must NOT fall through to the whole-task completion ask
			expect(mockTask.ask).not.toHaveBeenCalledWith("completion_result", "", false)
		})

		it("returns to parent when status drifted to 'active' but awaitingChildId still points here (the clobber regression)", async () => {
			// This is the exact state a late background-usage-drain save leaves the parent in:
			// status re-stamped "delegated" -> "active", awaitingChildId preserved.
			const block = setupDelegation({ status: "active", awaitingChildId: CHILD_ID })

			await attemptCompletionTool.handle(mockTask as Task, block, callbacks())

			expect(mockReopenParentFromDelegation).toHaveBeenCalledWith(
				expect.objectContaining({ parentTaskId: PARENT_ID, childTaskId: CHILD_ID }),
			)
			expect(mockTask.ask).not.toHaveBeenCalledWith("completion_result", "", false)
		})

		it("finalizes (does NOT delegate) when the parent was genuinely detached (awaitingChildId cleared)", async () => {
			const block = setupDelegation({ status: "active", awaitingChildId: undefined })

			await attemptCompletionTool.handle(mockTask as Task, block, callbacks())

			expect(mockReopenParentFromDelegation).not.toHaveBeenCalled()
			// falls through to the normal whole-task completion ask flow
			expect(mockTask.ask).toHaveBeenCalledWith("completion_result", "", false)
		})

		it("finalizes (does NOT delegate) when the parent is already completed", async () => {
			const block = setupDelegation({ status: "completed", awaitingChildId: CHILD_ID })

			await attemptCompletionTool.handle(mockTask as Task, block, callbacks())

			expect(mockReopenParentFromDelegation).not.toHaveBeenCalled()
			expect(mockTask.ask).toHaveBeenCalledWith("completion_result", "", false)
		})
	})
})
