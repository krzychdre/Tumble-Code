import { Task } from "../Task"
import { TaskAskSay } from "../TaskAskSay"

// Regression: when ask(type, text, false) lands on a finalized tail of the same type
// with the same text, TaskAskSay must reuse that message instead of appending a
// duplicate. The duplicate breaks executionId-based UI status routing (most visibly
// for execute_command, but the same shape affects every askApproval-using tool that
// shares ask:"tool" — codebase_search, read_file, apply_diff, list_files, etc.).
// See ai_plans/archive/2026-05/2026-05-15_21-16_fix-duplicate-execute-command-cards.md.

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
		flushClineMessages: vi.fn(async () => true),
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

type Seed = { ts: number; type: "ask" | "say"; ask?: string; say?: string; text: string; partial?: boolean }

const toolText = (fields: Record<string, unknown>) => JSON.stringify(fields)
const toolAsk = (ts: number, fields: Record<string, unknown>, partial = false): Seed => ({
	ts,
	type: "ask",
	ask: "tool",
	text: toolText(fields),
	partial,
})
const commandAsk = (ts: number, text: string, partial = false): Seed => ({
	ts,
	type: "ask",
	ask: "command",
	text,
	partial,
})
const sayRow = (ts: number, say: string): Seed => ({ ts, type: "say", say, text: "" })

/** Seeds clineMessages, then asks (and approves) `ask`/`text` with partial=false. */
async function askOnto(seed: Seed[], ask: "tool" | "command", text: string) {
	const { task, clineMessages } = makeTaskWithAskSay()
	clineMessages.push(...seed.map((m) => ({ ...m })))
	;(task as any).lastMessageTs = seed.at(-1)!.ts
	const pending = task.ask(ask, text, false)
	setTimeout(() => task.approveAsk(), 0)
	const result = await pending
	const asks = clineMessages.filter((m) => m.type === "ask")
	return { task, clineMessages, asks, result }
}

const readFile = (toolCallId: string, extra: Record<string, unknown> = {}) => ({
	tool: "readFile",
	path: "src/resource.py",
	isOutsideWorkspace: false,
	toolCallId,
	...extra,
})
const complete = { content: "/abs/src/resource.py", reason: "(lines 1-50)", startLine: 1 }

describe("TaskAskSay.ask: one card per tool invocation", () => {
	// The complete card lands on the card of its own invocation (same text, or same
	// toolCallId) instead of appending a duplicate that breaks executionId routing.
	it.each<[string, Seed[], "tool" | "command", string]>([
		["a finalized ask:command with the same text", [commandAsk(1, "echo hello")], "command", "echo hello"],
		["a partial ask:command tail with the same text", [commandAsk(1, "ls", true)], "command", "ls"],
		[
			"a finalized ask:tool with the same text and no toolCallId",
			[toolAsk(1, { tool: "codebaseSearch", query: "graphql", path: "lids", isOutsideWorkspace: false })],
			"tool",
			toolText({ tool: "codebaseSearch", query: "graphql", path: "lids", isOutsideWorkspace: false }),
		],
		[
			// Task 019e4189: read_file's placeholder and complete payload differ in text.
			"its own finalized placeholder, found by toolCallId",
			[toolAsk(1, readFile("call_a"))],
			"tool",
			toolText(readFile("call_a", complete)),
		],
		[
			"its own still-partial placeholder behind an intervening say",
			[toolAsk(1, readFile("call_b"), true), sayRow(2, "checkpoint_saved")],
			"tool",
			toolText(readFile("call_b", complete)),
		],
		[
			"its own finalized placeholder behind an intervening say",
			[toolAsk(1, readFile("call_c")), sayRow(2, "text")],
			"tool",
			toolText(readFile("call_c", complete)),
		],
	])("reuses %s", async (_label, seed, ask, text) => {
		const { asks, clineMessages, task, result } = await askOnto(seed, ask, text)

		expect(result.response).toBe("yesButtonClicked")
		expect(asks).toHaveLength(1)
		expect(asks[0]).toMatchObject({ ts: 1, text, partial: false })
		expect(clineMessages.map((m) => m.ts)).toEqual(seed.map((m) => m.ts))
		if (seed.length === 1) {
			expect((task as any).lastMessageTs).toBe(1)
		}
	})

	it.each<[string, Seed[], "tool" | "command", string]>([
		["a different text of the same ask type", [commandAsk(1, "ls")], "command", "pwd"],
		["a different ask type with the same text", [commandAsk(1, "ls")], "tool", "ls"],
		[
			"another invocation with the same path and range",
			[toolAsk(1, readFile("call_x1", complete))],
			"tool",
			toolText(readFile("call_x2", complete)),
		],
		[
			"another invocation behind an intervening say",
			[toolAsk(1, readFile("call_d1", complete)), sayRow(2, "checkpoint_saved")],
			"tool",
			toolText(readFile("call_d2", complete)),
		],
	])("appends a new card after %s", async (_label, seed, ask, text) => {
		const { asks, clineMessages } = await askOnto(seed, ask, text)

		expect(asks).toHaveLength(2)
		expect(asks[1].text).toBe(text)
		expect(clineMessages.at(-1)).toBe(asks[1])
	})

	it("updates a displaced partial placeholder in place on a later partial update", async () => {
		const { task, clineMessages } = makeTaskWithAskSay()
		clineMessages.push(toolAsk(1, readFile("call_p"), true), sayRow(2, "reasoning"))
		;(task as any).lastMessageTs = 1

		await task.ask("tool", toolText(readFile("call_p")), true).catch(() => {})

		const asks = clineMessages.filter((m) => m.type === "ask")
		expect(asks).toHaveLength(1)
		expect(asks[0]).toMatchObject({ ts: 1, partial: true })
	})
})
