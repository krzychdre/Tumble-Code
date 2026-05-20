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

	// --- Invocation-precise dedup keyed on the native tool-call id ---
	// Cards of one tool invocation share `toolCallId`; two invocations never do.
	// The dedup merges a finalized tail into the new complete card iff both
	// carry the SAME toolCallId. When ids are absent it falls back to exact-text
	// (the prior behavior), so non-adopting tools are unaffected.

	it("(a) merges the complete payload into its own finalized placeholder via toolCallId", async () => {
		// Real-world bug (task 019e4189 ui_messages.json): read_file's placeholder
		// and complete payloads differ in text but share the tool-call id.
		const { task, clineMessages } = makeTaskWithAskSay()
		const filePath = "lids_uniform_api/.../resource_aggregator_helper.py"
		const toolCallId = "call_abc123"

		const placeholderText = JSON.stringify({
			tool: "readFile",
			path: filePath,
			isOutsideWorkspace: false,
			toolCallId,
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: placeholderText, partial: false })
		;(task as any).lastMessageTs = seededTs

		const completeText = JSON.stringify({
			tool: "readFile",
			path: filePath,
			isOutsideWorkspace: false,
			content: `/abs/${filePath}`,
			reason: "(indentation mode at line 297)",
			startLine: 297,
			toolCallId,
		})

		const askPromise = task.ask("tool", completeText, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(1)
		expect(toolAsks[0].ts).toBe(seededTs)
		expect(toolAsks[0].text).toBe(completeText)
		expect((task as any).lastMessageTs).toBe(seededTs)
	})

	it("(a) merges search_files complete results into its own placeholder via toolCallId", async () => {
		const { task, clineMessages } = makeTaskWithAskSay()
		const dirPath = "src/services"
		const toolCallId = "call_search_1"

		const placeholderText = JSON.stringify({
			tool: "searchFiles",
			path: dirPath,
			regex: "graphql",
			content: "",
			isOutsideWorkspace: false,
			toolCallId,
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: placeholderText, partial: false })
		;(task as any).lastMessageTs = seededTs

		const completeText = JSON.stringify({
			tool: "searchFiles",
			path: dirPath,
			regex: "graphql",
			content: "src/services/a.ts\nsrc/services/b.ts",
			isOutsideWorkspace: false,
			toolCallId,
		})

		const askPromise = task.ask("tool", completeText, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(1)
		expect(toolAsks[0].ts).toBe(seededTs)
	})

	it("(b) keeps TWO cards for two read_file invocations of the SAME path, DIFFERENT ranges", async () => {
		// Two distinct invocations have distinct tool-call ids -> never merge.
		const { task, clineMessages } = makeTaskWithAskSay()
		const filePath = "src/resource.py"

		const firstComplete = JSON.stringify({
			tool: "readFile",
			path: filePath,
			isOutsideWorkspace: false,
			content: `/abs/${filePath}`,
			reason: "(lines 1-50)",
			startLine: 1,
			toolCallId: "call_read_1",
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: firstComplete, partial: false })
		;(task as any).lastMessageTs = seededTs

		const secondComplete = JSON.stringify({
			tool: "readFile",
			path: filePath,
			isOutsideWorkspace: false,
			content: `/abs/${filePath}`,
			reason: "(lines 100-150)",
			startLine: 100,
			toolCallId: "call_read_2",
		})

		const askPromise = task.ask("tool", secondComplete, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(2)
		expect(toolAsks.map((m) => JSON.parse(m.text).reason)).toEqual(["(lines 1-50)", "(lines 100-150)"])
	})

	it("(c) keeps TWO cards for two read_file invocations of the SAME path, SAME range", async () => {
		// Identical payloads except the tool-call id -> still two distinct cards.
		const { task, clineMessages } = makeTaskWithAskSay()
		const filePath = "src/resource.py"

		const first = JSON.stringify({
			tool: "readFile",
			path: filePath,
			isOutsideWorkspace: false,
			content: `/abs/${filePath}`,
			reason: "(lines 1-50)",
			startLine: 1,
			toolCallId: "call_x1",
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: first, partial: false })
		;(task as any).lastMessageTs = seededTs

		const second = JSON.stringify({
			tool: "readFile",
			path: filePath,
			isOutsideWorkspace: false,
			content: `/abs/${filePath}`,
			reason: "(lines 1-50)",
			startLine: 1,
			toolCallId: "call_x2",
		})

		const askPromise = task.ask("tool", second, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(2)
	})

	it("codebase_search placeholder -> race-finalize -> complete stays ONE card (no regression)", async () => {
		// codebase_search's placeholder and complete payloads are identical
		// ({tool,query,path,isOutsideWorkspace}, no content, no toolCallId). The
		// exact-text fallback must still dedup it after the streaming race.
		const { task, clineMessages } = makeTaskWithAskSay()
		const payload = JSON.stringify({
			tool: "codebaseSearch",
			query: "graphql requests",
			path: "lids/c6800/tests",
			isOutsideWorkspace: false,
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: payload, partial: false })
		;(task as any).lastMessageTs = seededTs

		const askPromise = task.ask("tool", payload, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(1)
		expect(toolAsks[0].ts).toBe(seededTs)
	})

	it("appends a second card when ids differ even if tool+path match (no id-collision merge)", async () => {
		// Defense in depth: a placeholder with one id must never be reused by a
		// complete card with a different id.
		const { task, clineMessages } = makeTaskWithAskSay()
		const filePath = "src/resource.py"

		const placeholder = JSON.stringify({
			tool: "readFile",
			path: filePath,
			isOutsideWorkspace: false,
			toolCallId: "call_p1",
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: placeholder, partial: false })
		;(task as any).lastMessageTs = seededTs

		const complete = JSON.stringify({
			tool: "readFile",
			path: filePath,
			isOutsideWorkspace: false,
			content: `/abs/${filePath}`,
			reason: "(lines 1-20)",
			toolCallId: "call_p2",
		})

		const askPromise = task.ask("tool", complete, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(2)
	})

	it("new_task: placeholder -> race-finalize -> complete collapses to ONE card via toolCallId", async () => {
		// new_task's placeholder (mode slug, raw todos) and complete payload
		// (resolved mode name, parsed todos) diverge in text; the id links them.
		const { task, clineMessages } = makeTaskWithAskSay()
		const toolCallId = "call_newtask_1"

		const placeholder = JSON.stringify({
			tool: "newTask",
			mode: "code",
			content: "Build the feature",
			toolCallId,
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: placeholder, partial: false })
		;(task as any).lastMessageTs = seededTs

		const complete = JSON.stringify({
			tool: "newTask",
			mode: "Code",
			content: "Build the feature",
			todos: [{ id: "1", content: "step", status: "pending" }],
			toolCallId,
		})

		const askPromise = task.ask("tool", complete, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(1)
		expect(toolAsks[0].ts).toBe(seededTs)
	})

	it("new_task: two distinct invocations stay TWO cards", async () => {
		const { task, clineMessages } = makeTaskWithAskSay()

		const first = JSON.stringify({ tool: "newTask", mode: "Code", content: "Task A", toolCallId: "call_nt_a" })
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: first, partial: false })
		;(task as any).lastMessageTs = seededTs

		const second = JSON.stringify({ tool: "newTask", mode: "Code", content: "Task A", toolCallId: "call_nt_b" })
		const askPromise = task.ask("tool", second, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(2)
	})

	it("write_to_file: placeholder -> race-finalize -> complete collapses to ONE card via toolCallId", async () => {
		// write_to_file's placeholder carries raw newContent; the complete card
		// carries a unified diff. Different text, same invocation -> one card.
		const { task, clineMessages } = makeTaskWithAskSay()
		const toolCallId = "call_write_1"

		const placeholder = JSON.stringify({
			tool: "newFileCreated",
			path: "src/new.ts",
			content: "export const x = 1\n",
			isOutsideWorkspace: false,
			toolCallId,
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: placeholder, partial: false })
		;(task as any).lastMessageTs = seededTs

		const complete = JSON.stringify({
			tool: "newFileCreated",
			path: "src/new.ts",
			content: "@@ -0,0 +1 @@\n+export const x = 1\n",
			isOutsideWorkspace: false,
			diffStats: { added: 1, removed: 0 },
			toolCallId,
		})

		const askPromise = task.ask("tool", complete, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(1)
		expect(toolAsks[0].ts).toBe(seededTs)
	})

	it("write_to_file: two distinct invocations on the same path stay TWO cards", async () => {
		const { task, clineMessages } = makeTaskWithAskSay()

		const first = JSON.stringify({
			tool: "editedExistingFile",
			path: "src/a.ts",
			content: "@@ first @@",
			toolCallId: "call_w_a",
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: first, partial: false })
		;(task as any).lastMessageTs = seededTs

		const second = JSON.stringify({
			tool: "editedExistingFile",
			path: "src/a.ts",
			content: "@@ second @@",
			toolCallId: "call_w_b",
		})
		const askPromise = task.ask("tool", second, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(2)
	})

	it("apply_diff / edit-family: placeholder -> race-finalize -> complete collapses to ONE card", async () => {
		// Diff-family tools (apply_diff, edit, edit_file, search_replace, apply_patch)
		// emit a content-less `diff`-only placeholder and a content-ful complete card.
		const { task, clineMessages } = makeTaskWithAskSay()
		const toolCallId = "call_diff_1"

		const placeholder = JSON.stringify({
			tool: "appliedDiff",
			path: "src/a.ts",
			diff: "1 edit operation",
			isOutsideWorkspace: false,
			toolCallId,
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: placeholder, partial: false })
		;(task as any).lastMessageTs = seededTs

		const complete = JSON.stringify({
			tool: "appliedDiff",
			path: "src/a.ts",
			diff: "1 edit operation",
			content: "@@ -1 +1 @@\n-old\n+new",
			isOutsideWorkspace: false,
			toolCallId,
		})

		const askPromise = task.ask("tool", complete, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(1)
		expect(toolAsks[0].ts).toBe(seededTs)
	})

	it("list_files: placeholder (content:'') -> complete collapses to ONE card via toolCallId", async () => {
		const { task, clineMessages } = makeTaskWithAskSay()
		const toolCallId = "call_list_1"

		const placeholder = JSON.stringify({
			tool: "listFilesTopLevel",
			path: "src",
			isOutsideWorkspace: false,
			content: "",
			toolCallId,
		})
		const seededTs = 1
		clineMessages.push({ ts: seededTs, type: "ask", ask: "tool", text: placeholder, partial: false })
		;(task as any).lastMessageTs = seededTs

		const complete = JSON.stringify({
			tool: "listFilesTopLevel",
			path: "src",
			isOutsideWorkspace: false,
			content: "src/a.ts\nsrc/b.ts",
			toolCallId,
		})

		const askPromise = task.ask("tool", complete, false)
		setTimeout(() => task.approveAsk(), 0)
		await askPromise

		const toolAsks = clineMessages.filter((m) => m.type === "ask" && m.ask === "tool")
		expect(toolAsks).toHaveLength(1)
		expect(toolAsks[0].ts).toBe(seededTs)
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
