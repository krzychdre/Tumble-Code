// npx vitest run core/task/__tests__/TaskLifecycle.abort-memory-writers.spec.ts

// Regression test for the Stop-button regression introduced with the memory
// background writers. `ClineProvider.cancelTask()` sets
// `task.abortReason = "user_cancelled"` and then calls `abortTask()`. Before
// the fix, `abortTask()`:
//   1. fired `triggerMemoryBackgroundWriters()` — which spawns a headless
//      sub-task that sends a FRESH LLM request, putting the inference engine
//      right back to work the moment the user pressed Stop, and
//   2. awaited `drainPendingExtraction(60_000)` — the stream loop awaits
//      `abortTask()` (TaskApiLoop.handleStreamError), so the drain held
//      `isStreaming === true` past cancelTask's 3s pWaitFor and froze the UI.
//
// The fix skips both when `abortReason === "user_cancelled"`. Non-cancelled
// aborts keep the previous behavior.

import { describe, it, expect, vi, beforeEach } from "vitest"

import { TaskLifecycle, type TaskLifecycleAccess } from "../TaskLifecycle"

vi.mock("../../memory", () => ({
	executeExtractMemories: vi.fn().mockResolvedValue(undefined),
	executeAutoDream: vi.fn().mockResolvedValue(undefined),
	drainPendingExtraction: vi.fn().mockResolvedValue(undefined),
	renderTranscript: vi.fn().mockReturnValue(""),
}))

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string, opts?: Record<string, unknown>) => {
		const count = opts?.count
		return count !== undefined ? `${key} ${count}` : key
	}),
}))

import { executeExtractMemories, executeAutoDream, drainPendingExtraction } from "../../memory"

function buildAccessStub(overrides: Partial<TaskLifecycleAccess> = {}): TaskLifecycleAccess {
	const provider = {
		memorySubTaskRunner: vi.fn(),
		getValue: vi.fn().mockReturnValue(undefined),
		notifyBackgroundOutcome: vi.fn(),
	}

	const access: Partial<TaskLifecycleAccess> = {
		taskId: "task-1",
		instanceId: "inst-1",
		isInitialized: true,
		abort: false,
		abandoned: false,
		abortReason: undefined,
		parentTaskId: undefined,
		clineMessages: [],
		apiConversationHistory: [],
		consecutiveNoToolUseCount: 0,
		consecutiveNoAssistantMessagesCount: 0,
		cwd: "/tmp/task-cwd",
		providerRef: { deref: () => provider } as unknown as TaskLifecycleAccess["providerRef"],
		emit: vi.fn() as unknown as TaskLifecycleAccess["emit"],
		emitFinalTokenUsageUpdate: vi.fn(),
		cancelCurrentRequest: vi.fn(),
		history: {
			saveClineMessages: vi.fn().mockResolvedValue(undefined),
		} as unknown as TaskLifecycleAccess["history"],
		...overrides,
	}
	return access as TaskLifecycleAccess
}

describe("TaskLifecycle.abortTask — memory writers vs user cancel", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does NOT fire memory writers and does NOT drain when abortReason is user_cancelled", async () => {
		const access = buildAccessStub({ abortReason: "user_cancelled" })
		const lifecycle = new TaskLifecycle(access)

		await lifecycle.abortTask()

		expect(executeExtractMemories).not.toHaveBeenCalled()
		expect(executeAutoDream).not.toHaveBeenCalled()
		expect(drainPendingExtraction).not.toHaveBeenCalled()
		expect(access.abort).toBe(true)
	})

	it("fires memory writers and drains on a non-cancelled abort", async () => {
		const access = buildAccessStub()
		const lifecycle = new TaskLifecycle(access)

		await lifecycle.abortTask()

		expect(executeExtractMemories).toHaveBeenCalledTimes(1)
		expect(executeAutoDream).toHaveBeenCalledTimes(1)
		expect(drainPendingExtraction).toHaveBeenCalledTimes(1)
	})

	it("keeps skipping writers for abandoned aborts (pre-existing behavior)", async () => {
		const access = buildAccessStub()
		const lifecycle = new TaskLifecycle(access)

		await lifecycle.abortTask(true)

		expect(executeExtractMemories).not.toHaveBeenCalled()
		expect(executeAutoDream).not.toHaveBeenCalled()
		// Drain still runs for abandoned aborts — that path covers extension
		// shutdown, where orphaning in-flight extraction is the concern.
		expect(drainPendingExtraction).toHaveBeenCalledTimes(1)
		expect(access.abandoned).toBe(true)
	})
})

describe("TaskLifecycle.triggerMemoryBackgroundWriters — visibility toasts", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("onSaved(2, ...) calls notifyBackgroundOutcome with a string containing '2'", async () => {
		const access = buildAccessStub()
		const lifecycle = new TaskLifecycle(access)

		lifecycle.triggerMemoryBackgroundWriters()

		expect(executeExtractMemories).toHaveBeenCalledTimes(1)
		const opts = (executeExtractMemories as ReturnType<typeof vi.fn>).mock.calls[0][0]
		opts.onSaved(2, [])

		const provider = access.providerRef.deref() as unknown as { notifyBackgroundOutcome: ReturnType<typeof vi.fn> }
		expect(provider.notifyBackgroundOutcome).toHaveBeenCalledTimes(1)
		expect(provider.notifyBackgroundOutcome.mock.calls[0][0]).toContain("2")
	})

	it("onSaved(0, []) does not call notifyBackgroundOutcome", async () => {
		const access = buildAccessStub()
		const lifecycle = new TaskLifecycle(access)

		lifecycle.triggerMemoryBackgroundWriters()

		const opts = (executeExtractMemories as ReturnType<typeof vi.fn>).mock.calls[0][0]
		opts.onSaved(0, [])

		const provider = access.providerRef.deref() as unknown as { notifyBackgroundOutcome: ReturnType<typeof vi.fn> }
		expect(provider.notifyBackgroundOutcome).not.toHaveBeenCalled()
	})

	it("onImproved(3, ...) calls notifyBackgroundOutcome with a string containing '3'", async () => {
		const access = buildAccessStub()
		const lifecycle = new TaskLifecycle(access)

		lifecycle.triggerMemoryBackgroundWriters()

		expect(executeAutoDream).toHaveBeenCalledTimes(1)
		const opts = (executeAutoDream as ReturnType<typeof vi.fn>).mock.calls[0][0]
		opts.onImproved(3)

		const provider = access.providerRef.deref() as unknown as { notifyBackgroundOutcome: ReturnType<typeof vi.fn> }
		expect(provider.notifyBackgroundOutcome).toHaveBeenCalledTimes(1)
		expect(provider.notifyBackgroundOutcome.mock.calls[0][0]).toContain("3")
	})

	it("onImproved(0) does not call notifyBackgroundOutcome", async () => {
		const access = buildAccessStub()
		const lifecycle = new TaskLifecycle(access)

		lifecycle.triggerMemoryBackgroundWriters()

		const opts = (executeAutoDream as ReturnType<typeof vi.fn>).mock.calls[0][0]
		opts.onImproved(0)

		const provider = access.providerRef.deref() as unknown as { notifyBackgroundOutcome: ReturnType<typeof vi.fn> }
		expect(provider.notifyBackgroundOutcome).not.toHaveBeenCalled()
	})
})
