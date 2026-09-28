// cd src && ./node_modules/.bin/vitest run core/task/__tests__/TaskApiLoop.abort-during-tool.spec.ts

// R4: after the stream ends, the loop waits until the tools have produced their results
// (userMessageContentReady). A task aborted while a tool is still running (for example during its
// approval ask) never sets that flag, so the wait had to include the abort flag or it polled forever.

import { TaskApiLoop } from "../TaskApiLoop"

function makeLoop() {
	const access: any = {
		taskId: "task-1",
		instanceId: "inst-1",
		abort: false,
		userMessageContentReady: false,
		assistantMessageContent: [{ type: "tool_use", id: "call-1", name: "read_file", params: {}, partial: false }],
		userMessageContent: [],
		settlePendingToolResultSpills: vi.fn().mockResolvedValue(undefined),
		streamProcessor: {
			finalizeStream: vi.fn().mockResolvedValue(undefined),
			assembleAndSaveAssistantMessage: vi.fn().mockResolvedValue(undefined),
			partialBlocks: [],
			assistantMessage: "",
		},
	}
	return { loop: new TaskApiLoop(access), access }
}

function finalize(loop: TaskApiLoop, stack: unknown[] = []) {
	return (loop as any).finalizeStreamAndProcessResults({ userContent: [] }, [], stack, vi.fn())
}

describe("TaskApiLoop.finalizeStreamAndProcessResults abort (R4)", () => {
	it("stops waiting for tool results when the task is aborted", async () => {
		const { loop, access } = makeLoop()
		const stack: unknown[] = []

		const result = finalize(loop, stack)
		setTimeout(() => {
			access.abort = true
		}, 30)

		const outcome = await Promise.race([
			result,
			new Promise((resolve) => setTimeout(() => resolve("still waiting"), 2_000)),
		])

		expect(outcome).toBe("return_true")
		expect(stack).toEqual([])
	})

	it("still continues with the tool results when they arrive", async () => {
		const { loop, access } = makeLoop()
		const stack: any[] = []

		const result = finalize(loop, stack)
		setTimeout(() => {
			access.userMessageContent.push({ type: "tool_result", tool_use_id: "call-1", content: "ok" })
			access.userMessageContentReady = true
		}, 30)

		expect(await result).toBe("continue")
		expect(stack).toHaveLength(1)
		expect(stack[0].userContent).toEqual([{ type: "tool_result", tool_use_id: "call-1", content: "ok" }])
	})

	// P10: a tool result spills to disk asynchronously; the preview that cites the artifact only
	// replaces the inline text once the file exists. The loop must settle those writes before it
	// snapshots userMessageContent for the next request, or the request carries the full text.
	it("settles pending tool-result spills before snapshotting the results", async () => {
		const { loop, access } = makeLoop()
		const stack: any[] = []
		access.settlePendingToolResultSpills = vi.fn(async () => {
			access.userMessageContent[0] = { type: "tool_result", tool_use_id: "call-1", content: "preview" }
		})
		access.userMessageContent.push({ type: "tool_result", tool_use_id: "call-1", content: "full text" })
		access.userMessageContentReady = true

		expect(await finalize(loop, stack)).toBe("continue")

		expect(access.settlePendingToolResultSpills).toHaveBeenCalledTimes(1)
		expect(stack[0].userContent).toEqual([{ type: "tool_result", tool_use_id: "call-1", content: "preview" }])
	})
})
