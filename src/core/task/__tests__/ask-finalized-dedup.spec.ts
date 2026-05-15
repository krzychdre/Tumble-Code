import { Task } from "../Task"
import { TaskAskSay } from "../TaskAskSay"

// Regression: when ask(type, text, false) lands on a finalized tail of the same type
// with the same text, TaskAskSay must reuse that message instead of appending a
// duplicate. The duplicate breaks executionId-based UI status routing (most visibly
// for execute_command, but the same shape affects every askApproval-using tool that
// shares ask:"tool" — codebase_search, read_file, apply_diff, list_files, etc.).
// See ai_plans/2026-05-15_21-16_fix-duplicate-execute-command-cards.md.

function makeTaskWithAskSay() {
	const task = Object.create(Task.prototype) as Task
	const clineMessages: any[] = []
	;(task as any).abort = false
	;(task as any).clineMessages = clineMessages
	;(task as any).askResponse = undefined
	;(task as any).askResponseText = undefined
	;(task as any).askResponseImages = undefined
	;(task as any).lastMessageTs = undefined
	;(task as any).taskId = "test-task-id"
	;(task as any).instanceId = "test-instance-id"
	;(task as any).idleAsk = undefined
	;(task as any).resumableAsk = undefined
	;(task as any).interactiveAsk = undefined
	;(task as any).autoApprovalTimeoutRef = undefined

	const historyStub = {
		addToClineMessages: vi.fn(async (m: any) => {
			clineMessages.push(m)
		}),
		saveClineMessages: vi.fn(async () => {}),
		updateClineMessage: vi.fn(async () => {}),
		findMessageByTimestamp: vi.fn((ts: number) => clineMessages.find((m) => m.ts === ts)),
	}
	;(task as any).history = historyStub
	;(task as any).messageQueueService = {
		isEmpty: () => true,
		dequeueMessage: () => undefined,
		messages: [],
	}
	;(task as any).checkpointSave = vi.fn(async () => {})
	;(task as any).emit = vi.fn()
	;(task as any).providerRef = { deref: () => undefined }
	;(task as any).askSay = new TaskAskSay(task as any)

	return { task, clineMessages }
}

describe("TaskAskSay.ask — finalized-duplicate dedup", () => {
	it("does not append a second ask:command when the tail is already a matching finalized ask:command", async () => {
		const { task, clineMessages } = makeTaskWithAskSay()
		const commandText = "echo hello"

		// Bug-state tail: a finalized partial that was finalized by some upstream path
		// before this second ask(..., false) call ran.
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "command", text: commandText, partial: false })
		;(task as any).lastMessageTs = seededTs

		const askPromise = task.ask("command", commandText, false)
		setTimeout(() => task.approveAsk(), 0)
		const result = await askPromise

		expect(result.response).toBe("yesButtonClicked")
		const commandAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "command")
		expect(commandAsks).toHaveLength(1)
		expect(commandAsks[0].ts).toBe(seededTs)
		expect((task as any).lastMessageTs).toBe(seededTs)
	})

	it("dedups ask:tool (covers codebase_search / read_file / apply_diff / etc.)", async () => {
		const { task, clineMessages } = makeTaskWithAskSay()
		const text = JSON.stringify({ tool: "codebaseSearch", query: "graphql requests", path: "lids/c6800/tests" })

		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text, partial: false })
		;(task as any).lastMessageTs = seededTs

		const askPromise = task.ask("tool", text, false)
		setTimeout(() => task.approveAsk(), 0)
		const result = await askPromise

		expect(result.response).toBe("yesButtonClicked")
		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(1)
		expect(toolAsks[0].ts).toBe(seededTs)
		expect((task as any).lastMessageTs).toBe(seededTs)
	})

	it("still appends when the tail has a different text (legitimate distinct ask)", async () => {
		const { task, clineMessages } = makeTaskWithAskSay()

		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "command", text: "ls", partial: false })
		;(task as any).lastMessageTs = seededTs

		const askPromise = task.ask("command", "pwd", false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const commandAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "command")
		expect(commandAsks).toHaveLength(2)
		expect(commandAsks.map((m) => m.text)).toEqual(["ls", "pwd"])
	})

	it("still appends when the tail has a different ask type", async () => {
		const { task, clineMessages } = makeTaskWithAskSay()

		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "command", text: "ls", partial: false })
		;(task as any).lastMessageTs = seededTs

		const askPromise = task.ask("tool", "ls", false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const asks = clineMessages.filter((m) => m.type === "ask")
		expect(asks).toHaveLength(2)
		expect(asks.map((m) => m.ask)).toEqual(["command", "tool"])
	})

	it("finalizes a partial tail in place (existing behavior preserved)", async () => {
		const { task, clineMessages } = makeTaskWithAskSay()

		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "command", text: "ls", partial: true })
		;(task as any).lastMessageTs = seededTs

		const askPromise = task.ask("command", "ls", false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		expect(clineMessages).toHaveLength(1)
		expect(clineMessages[0].ts).toBe(seededTs)
		expect(clineMessages[0].partial).toBe(false)
		expect((task as any).lastMessageTs).toBe(seededTs)
	})
})
