// Regression tests for the background usage drain wiring bug.
//
// Bug: `handleBackgroundUsageDrain` was handed `abortStream` where
// `createBackgroundUsageDrain` expects `updateApiReqMsg`. Because the drain's
// `captureUsageData` calls that callback after every successful request, every
// write ended up invoking `abortStream()`, which reverts any in-progress diff
// edit and forces the approved save into the `fs.writeFile` recovery path,
// leaving freshly-written files as dirty buffers ("agreed to save but not
// saved" / "newer version on disk").
//
// See ai_plans/2026-06-04_fix-diff-view-already-open-dirty-save.md.

import { describe, it, expect, vi, beforeEach } from "vitest"

import { TaskStreamProcessor, type TaskStreamProcessorAccess } from "../TaskStreamProcessor"

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureLlmCompletion: vi.fn(),
		},
	},
}))

function makeAccess(overrides: Partial<TaskStreamProcessorAccess> = {}): TaskStreamProcessorAccess {
	const apiReqMessage = { ts: 1, type: "say", say: "api_req_started", text: "{}" } as any
	return {
		taskId: "task-1",
		instanceId: "inst-1",
		abort: false,
		abandoned: false,
		apiConfiguration: { apiProvider: "anthropic" } as any,
		clineMessages: [apiReqMessage],
		didFinishAbortingStream: false,
		diffViewProvider: {
			isEditing: true,
			revertChanges: vi.fn().mockResolvedValue(undefined),
		} as any,
		history: {
			saveClineMessages: vi.fn().mockResolvedValue(undefined),
			updateClineMessage: vi.fn().mockResolvedValue(undefined),
		} as any,
		...overrides,
	} as unknown as TaskStreamProcessorAccess
}

function makeModelInfo() {
	return {
		maxTokens: 8192,
		contextWindow: 200000,
		supportsPromptCache: true,
		inputPrice: 3,
		outputPrice: 15,
	} as any
}

/** Single-item async iterator that completes immediately after the captured item. */
function doneIterator(): AsyncGenerator<any> {
	return {
		async next() {
			return { done: true, value: undefined }
		},
		async return() {
			return { done: true, value: undefined }
		},
		[Symbol.asyncIterator]() {
			return this
		},
	} as any
}

describe("TaskStreamProcessor background usage drain", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("reports usage through the updateApiReqMsg callback, never by aborting the stream", async () => {
		const access = makeAccess()
		const processor = new TaskStreamProcessor(access, {} as any)

		const updateApiReqMsg = vi.fn()
		const abortStream = processor.createAbortStreamFn(0, updateApiReqMsg)

		const drain = processor.createBackgroundUsageDrain(
			0,
			{ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: undefined },
			makeModelInfo(),
			doneIterator(),
			{ done: false, value: { type: "usage", inputTokens: 100, outputTokens: 50, totalCost: 0.01 } },
			// The drain must receive the message-updater, NOT abortStream.
			updateApiReqMsg,
		)

		await drain(0)

		// Usage was reported.
		expect(updateApiReqMsg).toHaveBeenCalled()
		// The drain reports usage as an *update*, never as a cancellation.
		for (const call of updateApiReqMsg.mock.calls) {
			expect(call[0]).toBeUndefined() // no cancelReason
		}
		// And it must never tear down an in-progress diff edit.
		expect(access.diffViewProvider.revertChanges).not.toHaveBeenCalled()
		expect(abortStream).toBeDefined()
	})

	it("abortStream (the function the drain must NOT be given) reverts an in-progress diff", async () => {
		const access = makeAccess()
		const processor = new TaskStreamProcessor(access, {} as any)

		const updateApiReqMsg = vi.fn()
		const abortStream = processor.createAbortStreamFn(0, updateApiReqMsg)

		await abortStream("streaming_failed")

		// This is precisely the destructive behavior that stranded dirty buffers
		// when abortStream was mistakenly wired into the usage drain.
		expect(access.diffViewProvider.revertChanges).toHaveBeenCalledTimes(1)
	})
})

// Regression: the drain is fire-and-forget and can outlive the task by up to
// DEFAULT_USAGE_COLLECTION_TIMEOUT_MS. For a parent disposed by delegation, a late
// saveClineMessages here re-stamps status (initialStatus "active") via taskMetadata,
// clobbering the "delegated" metadata and making the child finalize the whole task.
// The guard must suppress the persist once the owning task is aborted/abandoned, while
// still leaving the in-memory message update + telemetry intact.
// See ai_plans/2026-06-08_delegated-subtask-no-return.md.
describe("TaskStreamProcessor usage drain — abort/abandon persist guard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	async function runDrainWithUsage(access: TaskStreamProcessorAccess) {
		const processor = new TaskStreamProcessor(access, {} as any)
		const updateApiReqMsg = vi.fn()
		const drain = processor.createBackgroundUsageDrain(
			0,
			{ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: undefined },
			makeModelInfo(),
			doneIterator(),
			{ done: false, value: { type: "usage", inputTokens: 100, outputTokens: 50, totalCost: 0.01 } },
			updateApiReqMsg,
		)
		await drain(0)
		return { updateApiReqMsg }
	}

	it("persists history for a live task (abort=false, abandoned=false)", async () => {
		const access = makeAccess({ abort: false, abandoned: false })

		const { updateApiReqMsg } = await runDrainWithUsage(access)

		expect(updateApiReqMsg).toHaveBeenCalled()
		expect(access.history.saveClineMessages).toHaveBeenCalledTimes(1)
	})

	it("does NOT persist history once the task has been aborted (delegated-parent clobber)", async () => {
		const access = makeAccess({ abort: true, abandoned: false })

		const { updateApiReqMsg } = await runDrainWithUsage(access)

		// The in-memory update + webview message refresh still run...
		expect(updateApiReqMsg).toHaveBeenCalled()
		// ...but the durable history write that would clobber "delegated" is suppressed.
		expect(access.history.saveClineMessages).not.toHaveBeenCalled()
	})

	it("does NOT persist history once the task has been abandoned", async () => {
		const access = makeAccess({ abort: false, abandoned: true })

		await runDrainWithUsage(access)

		expect(access.history.saveClineMessages).not.toHaveBeenCalled()
	})
})
