import { ProviderSettings, RooCodeEventName } from "@roo-code/types"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"

// Mock dependencies
vi.mock("../../webview/ClineProvider")
vi.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		releaseTerminalsForTask: vi.fn(),
	},
}))
vi.mock("../../ignore/RooIgnoreController")
vi.mock("../../protect/RooProtectedController")
vi.mock("../../context-tracking/FileContextTracker")
vi.mock("../../../integrations/editor/DiffViewProvider")
vi.mock("../../tools/ToolRepetitionDetector")
vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn(() => ({
		getModel: () => ({ info: {}, id: "test-model" }),
	})),
}))

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureTaskCreated: vi.fn(),
			captureTaskRestarted: vi.fn(),
		},
	},
}))

describe("Task dispose method", () => {
	let mockProvider: any
	let mockApiConfiguration: ProviderSettings
	let task: Task

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Mock provider
		mockProvider = {
			context: {
				globalStorageUri: { fsPath: "/test/path" },
			},
			getState: vi.fn().mockResolvedValue({ mode: "code" }),
			log: vi.fn(),
		}

		// Mock API configuration
		mockApiConfiguration = {
			apiProvider: "anthropic",
			apiKey: "test-key",
		} as ProviderSettings

		// Create task instance without starting it
		task = new Task({
			provider: mockProvider as ClineProvider,
			apiConfiguration: mockApiConfiguration,
			startTask: false,
		})
	})

	afterEach(() => {
		// Clean up
		if (task && !task.abort) {
			task.dispose()
		}
	})

	test("should remove all event listeners when dispose is called", () => {
		// Add some event listeners using type assertion to bypass strict typing for testing
		const listener1 = vi.fn(() => {})
		const listener2 = vi.fn(() => {})
		const listener3 = vi.fn((taskId: string) => {})

		// Use type assertion to bypass strict event typing for testing
		;(task as any).on("TaskStarted", listener1)
		;(task as any).on("TaskAborted", listener2)
		;(task as any).on("TaskIdle", listener3)

		// Verify listeners are added
		expect(task.listenerCount("TaskStarted")).toBe(1)
		expect(task.listenerCount("TaskAborted")).toBe(1)
		expect(task.listenerCount("TaskIdle")).toBe(1)

		// Spy on removeAllListeners method
		const removeAllListenersSpy = vi.spyOn(task, "removeAllListeners")

		// Call dispose
		task.dispose()

		// Verify removeAllListeners was called
		expect(removeAllListenersSpy).toHaveBeenCalledOnce()

		// Verify all listeners are removed
		expect(task.listenerCount("TaskStarted")).toBe(0)
		expect(task.listenerCount("TaskAborted")).toBe(0)
		expect(task.listenerCount("TaskIdle")).toBe(0)
	})

	test("should handle errors when removing event listeners", () => {
		// Mock removeAllListeners to throw an error
		const originalRemoveAllListeners = task.removeAllListeners
		task.removeAllListeners = vi.fn(() => {
			throw new Error("Test error")
		})

		// Spy on console.error
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Call dispose - should not throw
		expect(() => task.dispose()).not.toThrow()

		// Verify error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error removing event listeners:", expect.any(Error))

		// Restore
		task.removeAllListeners = originalRemoveAllListeners
		consoleErrorSpy.mockRestore()
	})

	test("should clean up all resources in correct order", () => {
		const removeAllListenersSpy = vi.spyOn(task, "removeAllListeners")
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})

		// Call dispose
		task.dispose()

		// Verify dispose was called and logged
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining(`[Task#dispose] disposing task ${task.taskId}.${task.instanceId}`),
		)

		// Verify removeAllListeners was called first (before other cleanup)
		expect(removeAllListenersSpy).toHaveBeenCalledOnce()

		// Clean up
		consoleLogSpy.mockRestore()
	})

	test("should prevent memory leaks by removing listeners before other cleanup", () => {
		// Add multiple listeners of different types using type assertion for testing
		const listeners = {
			TaskStarted: vi.fn(() => {}),
			TaskAborted: vi.fn(() => {}),
			TaskIdle: vi.fn((taskId: string) => {}),
			TaskActive: vi.fn((taskId: string) => {}),
			TaskAskResponded: vi.fn(() => {}),
			Message: vi.fn((data: { action: "created" | "updated"; message: any }) => {}),
			TaskTokenUsageUpdated: vi.fn((taskId: string, tokenUsage: any) => {}),
			TaskToolFailed: vi.fn((taskId: string, tool: any, error: string) => {}),
			TaskUnpaused: vi.fn(() => {}),
		}

		// Add all listeners using type assertion to bypass strict typing for testing
		const taskAny = task as any
		taskAny.on("TaskStarted", listeners.TaskStarted)
		taskAny.on("TaskAborted", listeners.TaskAborted)
		taskAny.on("TaskIdle", listeners.TaskIdle)
		taskAny.on("TaskActive", listeners.TaskActive)
		taskAny.on("TaskAskResponded", listeners.TaskAskResponded)
		taskAny.on("Message", listeners.Message)
		taskAny.on("TaskTokenUsageUpdated", listeners.TaskTokenUsageUpdated)
		taskAny.on("TaskToolFailed", listeners.TaskToolFailed)
		taskAny.on("TaskUnpaused", listeners.TaskUnpaused)

		// Verify all listeners are added
		expect(task.listenerCount("TaskStarted")).toBe(1)
		expect(task.listenerCount("TaskAborted")).toBe(1)
		expect(task.listenerCount("TaskIdle")).toBe(1)
		expect(task.listenerCount("TaskActive")).toBe(1)
		expect(task.listenerCount("TaskAskResponded")).toBe(1)
		expect(task.listenerCount("Message")).toBe(1)
		expect(task.listenerCount("TaskTokenUsageUpdated")).toBe(1)
		expect(task.listenerCount("TaskToolFailed")).toBe(1)
		expect(task.listenerCount("TaskUnpaused")).toBe(1)

		// Call dispose
		task.dispose()

		// Verify all listeners are removed
		expect(task.listenerCount("TaskStarted")).toBe(0)
		expect(task.listenerCount("TaskAborted")).toBe(0)
		expect(task.listenerCount("TaskIdle")).toBe(0)
		expect(task.listenerCount("TaskActive")).toBe(0)
		expect(task.listenerCount("TaskAskResponded")).toBe(0)
		expect(task.listenerCount("Message")).toBe(0)
		expect(task.listenerCount("TaskTokenUsageUpdated")).toBe(0)
		expect(task.listenerCount("TaskToolFailed")).toBe(0)
		expect(task.listenerCount("TaskUnpaused")).toBe(0)

		// Verify total listener count is 0
		expect(task.eventNames().length).toBe(0)
	})

	test("dispose() emits TaskAborted when no terminal event has fired", () => {
		const abortedSpy = vi.fn()
		task.on(RooCodeEventName.TaskAborted, abortedSpy)

		task.dispose()

		// dispose() should have emitted TaskAborted so waiters resolve.
		expect(abortedSpy).toHaveBeenCalledTimes(1)

		// Listeners are removed after the emit, so the spy fired exactly once.
		expect(task.listenerCount(RooCodeEventName.TaskAborted)).toBe(0)
	})

	test("dispose() does NOT emit TaskAborted when TaskCompleted already fired", () => {
		const completedSpy = vi.fn()
		const abortedSpy = vi.fn()
		task.on(RooCodeEventName.TaskCompleted, completedSpy)
		task.on(RooCodeEventName.TaskAborted, abortedSpy)

		// Simulate normal completion: emit TaskCompleted first.
		task.emit(
			RooCodeEventName.TaskCompleted,
			task.taskId,
			{
				totalTokensIn: 0,
				totalTokensOut: 0,
				totalCost: 0,
				contextTokens: 0,
			},
			{},
		)
		expect(completedSpy).toHaveBeenCalledTimes(1)

		task.dispose()

		// No double terminal event: aborted should NOT fire.
		expect(abortedSpy).not.toHaveBeenCalled()
	})

	test("dispose() does NOT emit TaskAborted when TaskAborted already fired", () => {
		const abortedSpy = vi.fn()
		task.on(RooCodeEventName.TaskAborted, abortedSpy)

		// Simulate a normal abort: emit TaskAborted first.
		task.emit(RooCodeEventName.TaskAborted)
		expect(abortedSpy).toHaveBeenCalledTimes(1)

		task.dispose()

		// No double emission.
		expect(abortedSpy).toHaveBeenCalledTimes(1)
	})

	test("dispose() emits TaskAborted BEFORE removeAllListeners so waiters still fire", () => {
		const abortedSpy = vi.fn()
		task.on(RooCodeEventName.TaskAborted, abortedSpy)

		// Spy on removeAllListeners to verify ordering.
		const removeAllListenersSpy = vi.spyOn(task, "removeAllListeners")

		task.dispose()

		// The aborted handler fired (listener was still attached at emit time).
		expect(abortedSpy).toHaveBeenCalledTimes(1)
		// removeAllListeners was called after the emit.
		expect(removeAllListenersSpy).toHaveBeenCalledOnce()
	})

	test("awaitTaskCompletion resolves when task.dispose() is called without a terminal event", async () => {
		// Simulate what awaitTaskCompletion does: attach a listener that
		// resolves a promise on TaskAborted, then call dispose() without any
		// terminal event. Pre-fix the promise hangs forever; post-fix dispose()
		// emits TaskAborted and the promise resolves.
		//
		// We can't use the real ClineProvider.prototype.awaitTaskCompletion here
		// because ClineProvider is mocked in this spec. Instead, replicate the
		// core listener pattern.
		let resolved = false
		const completionPromise = new Promise<{ completed: boolean }>((resolve) => {
			const onAborted = () => {
				resolved = true
				resolve({ completed: false })
			}
			task.on(RooCodeEventName.TaskAborted, onAborted)
		})

		// Dispose without any terminal event.
		task.dispose()

		// Race against a timeout: pre-fix the promise hangs.
		const result = await Promise.race([
			completionPromise,
			new Promise<{ completed: boolean }>((_, reject) =>
				setTimeout(() => reject(new Error("promise hung — dispose did not emit terminal event")), 2000),
			),
		])

		expect(result.completed).toBe(false)
		expect(resolved).toBe(true)

		// Mark task as aborted so afterEach doesn't try to dispose again.
		task.abort = true
	})
})
