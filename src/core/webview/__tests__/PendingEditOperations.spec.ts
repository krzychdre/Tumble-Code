import { PendingEditOperations } from "../PendingEditOperations"

describe("PendingEditOperations", () => {
	const editData = {
		messageTs: 123,
		editedContent: "new text",
		messageIndex: 2,
		apiConversationHistoryIndex: 1,
	}

	test("set then get returns the stored operation", () => {
		const ops = new PendingEditOperations()
		ops.set("task-1", { ...editData })
		expect(ops.get("task-1")).toMatchObject({ ...editData })
		expect(ops.get("task-1")?.timeoutId).toBeDefined()
		expect(ops.get("task-1")?.createdAt).toBeGreaterThan(0)
	})

	test("get of an unknown id is undefined", () => {
		const ops = new PendingEditOperations()
		expect(ops.get("nope")).toBeUndefined()
	})

	test("set replaces an existing operation with the same id", () => {
		const ops = new PendingEditOperations()
		ops.set("task-1", { ...editData, editedContent: "first" })
		ops.set("task-1", { ...editData, editedContent: "second" })
		expect(ops.get("task-1")?.editedContent).toBe("second")
	})

	test("clear removes the operation and reports true; second clear reports false", () => {
		const ops = new PendingEditOperations()
		ops.set("task-1", { ...editData })
		expect(ops.clear("task-1")).toBe(true)
		expect(ops.get("task-1")).toBeUndefined()
		expect(ops.clear("task-1")).toBe(false)
	})

	test("clearAll empties every operation", () => {
		const ops = new PendingEditOperations()
		ops.set("task-1", { ...editData })
		ops.set("task-2", { ...editData })
		ops.clearAll()
		expect(ops.get("task-1")).toBeUndefined()
		expect(ops.get("task-2")).toBeUndefined()
	})

	test("entries clear themselves after the timeout", () => {
		vi.useFakeTimers()
		try {
			const ops = new PendingEditOperations()
			ops.set("task-1", { ...editData })
			vi.advanceTimersByTime(30_000)
			expect(ops.get("task-1")).toBeUndefined()
		} finally {
			vi.useRealTimers()
		}
	})

	describe("replayInto", () => {
		function makeTask(messageTs: number[], apiTs: number[]) {
			return {
				clineMessages: messageTs.map((ts) => ({ ts })),
				apiConversationHistory: apiTs.map((ts) => ({ ts })),
				overwriteClineMessages: vi.fn(),
				overwriteApiConversationHistory: vi.fn(),
				handleWebviewAskResponse: vi.fn(),
			}
		}

		beforeEach(() => vi.useFakeTimers())
		afterEach(() => vi.useRealTimers())

		test("cuts both histories at the edited message and sends the edited text, once", async () => {
			const ops = new PendingEditOperations()
			ops.set("task-1", { ...editData, images: ["img"] })
			const task = makeTask([100, 123, 130], [123, 130])

			ops.replayInto(task as any, "task-1")
			expect(ops.get("task-1")).toBeUndefined()
			await vi.advanceTimersByTimeAsync(100)

			expect(task.overwriteClineMessages).toHaveBeenCalledWith([{ ts: 100 }])
			expect(task.overwriteApiConversationHistory).toHaveBeenCalledWith([])
			expect(task.handleWebviewAskResponse).toHaveBeenCalledExactlyOnceWith("messageResponse", "new text", [
				"img",
			])
		})

		test("does nothing when the edited message is not in the restored task", async () => {
			const ops = new PendingEditOperations()
			ops.set("task-1", { ...editData })
			const task = makeTask([100], [100])

			ops.replayInto(task as any, "task-1")
			await vi.advanceTimersByTimeAsync(100)

			expect(task.overwriteClineMessages).not.toHaveBeenCalled()
			expect(task.handleWebviewAskResponse).not.toHaveBeenCalled()
		})
	})
})
