// npx vitest run core/condense/__tests__/index.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import { TelemetryService } from "@tumble-code/telemetry"
import { TelemetryEventName } from "@tumble-code/types"

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../../../api"
import { ApiMessage } from "../../task-persistence/apiMessages"
import {
	summarizeConversation,
	getMessagesSinceLastSummary,
	getEffectiveApiHistory,
	cleanupAfterTruncation,
	extractCommandBlocks,
	injectSyntheticToolResults,
	toolUseToText,
	toolResultToText,
	transformMessagesForCondensing,
	type SummarizeConversationOptions,
} from "../index"
import { logger } from "../../../utils/logging"

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		instance: { capture: vi.fn() },
	},
}))

const taskId = "test-task-id"

const toolUse = (id: string): Anthropic.Messages.ToolUseBlockParam => ({
	type: "tool_use",
	id,
	name: "read_file",
	input: { path: `${id}.ts` },
})
const toolResult = (id: string, content = `result ${id}`): Anthropic.Messages.ToolResultBlockParam => ({
	type: "tool_result",
	tool_use_id: id,
	content,
})
const text = (value: string): Anthropic.Messages.TextBlockParam => ({ type: "text", text: value })

/** A plain conversation of `n` messages alternating user/assistant, starting with `first`. */
function conversation(n: number, first: ApiMessage["content"] = "Initial ask"): ApiMessage[] {
	return Array.from({ length: n }, (_, i) => ({
		role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
		content: i === 0 ? first : `message ${i}`,
		ts: i + 1,
	}))
}

/** Shortest readable label of each message: its content when a string, else its block types/ids. */
function labels(messages: ApiMessage[]): string[] {
	return messages.map((m) =>
		typeof m.content === "string"
			? m.content
			: m.content
					.map((b) =>
						b.type === "tool_result" ? `result:${b.tool_use_id}` : b.type === "text" ? b.text : b.type,
					)
					.join("+"),
	)
}

function handler(summary = "This is a summary", options: { cost?: number; tokens?: number[] } = {}): ApiHandler {
	const tokens = [...(options.tokens ?? [])]
	return {
		createMessage: vi.fn(() =>
			(async function* () {
				yield { type: "text" as const, text: summary }
				yield { type: "usage" as const, totalCost: options.cost ?? 0.05, outputTokens: 150 }
			})(),
		),
		countTokens: vi.fn(async () => tokens.shift() ?? 100),
		getModel: vi.fn(() => ({ id: "test-model", info: { contextWindow: 8000, supportsImages: true } })),
	} as unknown as ApiHandler
}

const summarize = (options: Partial<SummarizeConversationOptions> & { messages: ApiMessage[] }) =>
	summarizeConversation({ apiHandler: handler(), systemPrompt: "sys", taskId, ...options })

const summaryBlocks = (messages: ApiMessage[]) =>
	(messages.find((m) => m.isSummary)!.content as Anthropic.Messages.TextBlockParam[]).map((b) => b.text)

describe("extractCommandBlocks", () => {
	it.each<[string, ApiMessage["content"], string]>([
		[
			"one block in a string",
			'Some text <command name="prr">/prr #123</command> more',
			'<command name="prr">/prr #123</command>',
		],
		[
			"several blocks, joined by newlines",
			'<command name="prr">/prr #1</command> text <command name="mode" a="b">/mode code</command>',
			'<command name="prr">/prr #1</command>\n<command name="mode" a="b">/mode code</command>',
		],
		[
			"text blocks of an array",
			[text("Some user text"), text('<command name="prr">Help\ncontent</command>')],
			'<command name="prr">Help\ncontent</command>',
		],
		["no command", "Just regular text", ""],
	])("extracts %s", (_label, content, expected) => {
		expect(extractCommandBlocks({ role: "user", content })).toBe(expected)
	})
})

describe("injectSyntheticToolResults", () => {
	it.each<[string, ApiMessage[]]>([
		[
			"every call is answered",
			[
				{ role: "assistant", content: [toolUse("t1")] },
				{ role: "user", content: [toolResult("t1")] },
			],
		],
		[
			"answers are spread across user messages",
			[
				{ role: "assistant", content: [toolUse("t1"), toolUse("t2")] },
				{ role: "user", content: [toolResult("t1")] },
				{ role: "user", content: [toolResult("t2")] },
			],
		],
		["there are no tool blocks", conversation(2)],
	])("returns the messages unchanged when %s", (_label, messages) => {
		expect(injectSyntheticToolResults(messages)).toBe(messages)
	})

	it("appends one user message answering only the unanswered calls", () => {
		const messages: ApiMessage[] = [
			{ role: "assistant", content: [toolUse("answered"), toolUse("orphan-1"), toolUse("orphan-2")] },
			{ role: "user", content: [toolResult("answered")] },
		]

		const result = injectSyntheticToolResults(messages)

		expect(result.slice(0, 2)).toEqual(messages)
		expect(result[2].role).toBe("user")
		expect(result[2].content).toEqual(
			["orphan-1", "orphan-2"].map((id) =>
				toolResult(id, "Context condensation triggered. Tool execution deferred."),
			),
		)
	})
})

describe("getMessagesSinceLastSummary", () => {
	it.each<[string, ApiMessage[], string[]]>([
		["all messages without a summary", conversation(3), ["Initial ask", "message 1", "message 2"]],
		[
			"from the last of several summaries",
			[
				{ role: "user", content: "a" },
				{ role: "user", content: "S1", isSummary: true },
				{ role: "assistant", content: "b" },
				{ role: "user", content: "S2", isSummary: true },
				{ role: "assistant", content: "c" },
			],
			["S2", "c"],
		],
		["nothing from an empty history", [], []],
	])("returns %s", (_label, messages, expected) => {
		expect(labels(getMessagesSinceLastSummary(messages))).toEqual(expected)
	})
})

describe("getEffectiveApiHistory", () => {
	const summary = (condenseId = "c1"): ApiMessage => ({
		role: "user",
		content: [text("Summary")],
		isSummary: true,
		condenseId,
	})
	const condensed = (content: ApiMessage["content"], role: "user" | "assistant" = "user"): ApiMessage => ({
		role,
		content,
		condenseParent: "c1",
	})

	it.each<[string, ApiMessage[], string[]]>([
		["all messages without a summary", conversation(3), ["Initial ask", "message 1", "message 2"]],
		[
			"the summary and what follows it, dropping condensed messages",
			[condensed("old"), condensed("older", "assistant"), summary(), { role: "assistant", content: "new" }],
			["Summary", "new"],
		],
		[
			"orphaned condensed messages when the summary was deleted by a rewind",
			[condensed("a"), condensed("b", "assistant")],
			["a", "b"],
		],
		[
			"only the latest of nested summaries and what follows it",
			[
				condensed("task"),
				{ ...summary("c1"), content: "S1", condenseParent: "c2" },
				{ role: "assistant", content: "after S1", condenseParent: "c2" },
				{ ...summary("c2"), content: "S2" },
				{ role: "assistant", content: "current" },
			],
			["S2", "current"],
		],
		[
			"no message hidden by a truncation marker after the summary",
			[
				summary(),
				{ role: "assistant", content: "hidden", truncationParent: "t1" },
				{ role: "assistant", content: [text("marker")], isTruncationMarker: true, truncationId: "t1" },
				{ role: "user", content: "after" },
			],
			["Summary", "marker", "after"],
		],
		[
			"no message hidden by a truncation marker without a summary",
			[
				{ role: "user", content: "hidden", truncationParent: "t1" },
				{ role: "assistant", content: [text("marker")], isTruncationMarker: true, truncationId: "t1" },
				{ role: "user", content: "orphan", truncationParent: "gone" },
			],
			["marker", "orphan"],
		],
		[
			"no tool_result whose tool_use was condensed away, keeping the rest of its message",
			[
				condensed([toolUse("gone-1"), toolUse("gone-2")], "assistant"),
				summary(),
				{ role: "user", content: [toolResult("gone-1"), toolResult("gone-2")] },
				{ role: "assistant", content: [toolUse("kept")] },
				{ role: "user", content: [toolResult("gone-1"), text("typed"), toolResult("kept")] },
			],
			["Summary", "tool_use", "typed+result:kept"],
		],
	])("returns %s", (_label, messages, expected) => {
		expect(labels(getEffectiveApiHistory(messages))).toEqual(expected)
	})
})

describe("cleanupAfterTruncation", () => {
	it("clears parent references whose summary or marker is gone and keeps the live ones", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "a", condenseParent: "deleted" },
			{ role: "assistant", content: "b", condenseParent: "live" },
			{ role: "user", content: "c", truncationParent: "deleted-marker" },
			{ role: "assistant", content: "d", truncationParent: "live-marker" },
			{ role: "user", content: "e", condenseParent: "live", truncationParent: "deleted-marker" },
			{ role: "user", content: "f", condenseParent: "deleted", truncationParent: "live-marker" },
			{ role: "user", content: [text("S")], isSummary: true, condenseId: "live" },
			{ role: "assistant", content: [text("M")], isTruncationMarker: true, truncationId: "live-marker" },
		]

		const result = cleanupAfterTruncation(messages)

		expect(result.slice(0, 6).map((m) => [m.condenseParent, m.truncationParent])).toEqual([
			[undefined, undefined],
			["live", undefined],
			[undefined, undefined],
			[undefined, "live-marker"],
			["live", undefined],
			[undefined, "live-marker"],
		])
		expect(result[1]).toBe(messages[1])
		expect(result.slice(6)).toEqual(messages.slice(6))
	})
})

describe("rewind after condense (upstream #8295)", () => {
	// Two nested condenses; a rewind then deletes everything from `cut` on.
	const history: ApiMessage[] = [
		{ role: "user", content: "task", ts: 1, condenseParent: "c1" },
		{ role: "assistant", content: "a1", ts: 2, condenseParent: "c1" },
		{ role: "user", content: [text("S1")], ts: 3, isSummary: true, condenseId: "c1", condenseParent: "c2" },
		{ role: "assistant", content: "a2", ts: 4, condenseParent: "c2" },
		{ role: "user", content: [text("S2")], ts: 5, isSummary: true, condenseId: "c2" },
		{ role: "assistant", content: "a3", ts: 6 },
	]

	it.each<[string, number, string[]]>([
		["the latest summary brings back the earlier summary and its tail", 4, ["S1", "a2"]],
		["both summaries brings back the whole conversation", 2, ["task", "a1"]],
	])("deleting %s", (_label, cut, expected) => {
		const cleaned = cleanupAfterTruncation(history.slice(0, cut))

		expect(labels(getEffectiveApiHistory(cleaned))).toEqual(expected)
		expect(cleaned.filter((m) => m.condenseParent && m.condenseParent !== "c1")).toEqual([])
	})
})

describe("summarizeConversation", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(logger, "error").mockImplementation(() => {})
	})
	afterEach(() => vi.restoreAllMocks())

	it.each<[string, ApiMessage[]]>([
		["a single message", conversation(1)],
		[
			"only a summary since the last condense",
			[...conversation(1), { role: "user", content: "S", isSummary: true }],
		],
		[
			"a summary and one message since the last condense",
			[...conversation(1), { role: "user", content: "S", isSummary: true }, { role: "assistant", content: "x" }],
		],
	])("refuses to condense %s, without calling the model", async (_label, messages) => {
		const apiHandler = handler()

		const result = await summarize({ messages, apiHandler })

		expect(result).toMatchObject({ messages, cost: 0, summary: "" })
		expect(result.error).toBeTruthy()
		expect(apiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("sends the history as text, with the condense instructions last, under the summary-only system prompt", async () => {
		const apiHandler = handler()
		const messages: ApiMessage[] = [
			...conversation(4),
			{ role: "assistant", content: [toolUse("unanswered")], ts: 5 },
		]

		await summarize({ messages, apiHandler })

		const [prompt, request, metadata] = vi.mocked(apiHandler.createMessage).mock.calls[0]
		expect(prompt).toContain("CRITICAL: This is a summarization-only request")
		expect(metadata).toBeUndefined()
		expect(request.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
			"assistant",
			"user",
			"user",
		])
		expect(request[0].content).toBe("Initial ask")
		// The unanswered call is answered synthetically and both are flattened to text.
		expect(JSON.stringify(request.slice(4, 6))).not.toMatch(/"type":"tool_(use|result)"/)
		expect((request[5].content as Anthropic.Messages.TextBlockParam[])[0].text).toContain("Tool execution deferred")
		expect(request[6].content).toContain("Your task is to create a detailed summary of the conversation")
	})

	it.each<[string, string | undefined, boolean]>([
		["a custom prompt replaces the instructions", "Custom summarization prompt", true],
		["a blank custom prompt falls back to the default", "  ", false],
	])("%s and is reported", async (_label, customCondensingPrompt, usedCustomPrompt) => {
		const apiHandler = handler()

		await summarize({ messages: conversation(5), apiHandler, customCondensingPrompt, isAutomaticTrigger: true })

		const request = vi.mocked(apiHandler.createMessage).mock.calls[0][1]
		const instructions = request[request.length - 1].content as string
		expect(instructions === "Custom summarization prompt").toBe(usedCustomPrompt)
		expect(TelemetryService.instance.capture).toHaveBeenCalledWith(TelemetryEventName.CONTEXT_CONDENSED, {
			taskId,
			isAutomaticTrigger: true,
			usedCustomPrompt,
		})
	})

	it("returns the summary as the last, user-role message and tags every original message", async () => {
		const messages = conversation(5)

		const result = await summarize({ messages })

		const last = result.messages[result.messages.length - 1]
		expect(last).toMatchObject({ role: "user", isSummary: true, ts: 6, condenseId: result.condenseId })
		expect(summaryBlocks(result.messages)).toEqual(["## Conversation Summary\nThis is a summary"])
		expect(result.messages.slice(0, 5).every((m) => m.condenseParent === result.condenseId)).toBe(true)
		expect(result).toMatchObject({
			summary: "This is a summary",
			cost: 0.05,
			newContextTokens: 100,
		})
		expect(result.error).toBeUndefined()
	})

	it("leaves an already condensed message with its own parent", async () => {
		const earlier: ApiMessage = { role: "user", content: "earlier", ts: 0, condenseParent: "older-condense" }

		const result = await summarize({ messages: [earlier, ...conversation(4)] })

		expect(result.messages[0]).toBe(earlier)
		expect(result.messages[1].condenseParent).toBe(result.condenseId)
	})

	it("carries the command blocks of the first message into a system-reminder block", async () => {
		const result = await summarize({
			messages: conversation(5, [text("Some user text"), text('<command name="prr">/prr #123</command>')]),
		})

		const blocks = summaryBlocks(result.messages)
		expect(blocks).toHaveLength(2)
		expect(blocks[1]).toContain("<system-reminder>\n## Active Workflows")
		expect(blocks[1]).toContain('<command name="prr">/prr #123</command>')
	})

	it.each<[string, boolean, string, number]>([
		[
			"an automatic condense keeps the environment details",
			true,
			"<environment_details>x</environment_details>",
			2,
		],
		["a manual condense drops the environment details", false, "<environment_details>x</environment_details>", 1],
		["blank environment details are dropped", true, "   ", 1],
	])("%s", async (_label, isAutomaticTrigger, environmentDetails, blockCount) => {
		const result = await summarize({ messages: conversation(5), isAutomaticTrigger, environmentDetails })

		const blocks = summaryBlocks(result.messages)
		expect(blocks).toHaveLength(blockCount)
		if (blockCount === 2) {
			expect(blocks[1]).toBe(environmentDetails)
		}
	})

	it("counts the system prompt with the summary, then the tool definitions", async () => {
		const apiHandler = handler("S", { tokens: [70, 30] })
		const metadata = { taskId, tools: [{ type: "function", function: { name: "read_file" } }] }

		const result = await summarize({
			messages: conversation(5),
			apiHandler,
			metadata: metadata as unknown as ApiHandlerCreateMessageMetadata,
		})

		expect(result.newContextTokens).toBe(100)
		expect(vi.mocked(apiHandler.countTokens).mock.calls).toEqual([
			[[text("sys"), text("## Conversation Summary\nS")]],
			[[text(JSON.stringify(metadata.tools))]],
		])
		expect(vi.mocked(apiHandler.createMessage).mock.calls[0][2]).toBe(metadata)
	})

	it("returns an error and keeps the spent cost when the model answers with nothing", async () => {
		const messages = conversation(5)

		const result = await summarize({ messages, apiHandler: handler("  ", { cost: 0.02 }) })

		expect(result).toMatchObject({ messages, cost: 0.02, summary: "" })
		expect(result.newContextTokens).toBeUndefined()
		expect(result.error).toBeTruthy()
	})
})

describe("tool blocks as text", () => {
	it.each<[string, unknown, string]>([
		["flat object input", { path: "test.ts", encoding: "utf-8" }, "path: test.ts\nencoding: utf-8"],
		["nested values as JSON", { content: { key: 1 } }, 'content: {\n  "key": 1\n}'],
		["string input", "ls -la", "ls -la"],
		["empty input", {}, ""],
	])("toolUseToText renders %s", (_label, input, body) => {
		const block = { type: "tool_use", id: "t", name: "some_tool", input } as Anthropic.Messages.ToolUseBlockParam

		expect(toolUseToText(block)).toBe(`[Tool Use: some_tool]\n${body}`)
	})

	it.each<[string, Partial<Anthropic.Messages.ToolResultBlockParam>, string]>([
		["string content", { content: "File contents" }, "[Tool Result]\nFile contents"],
		["an error", { content: "Not found", is_error: true }, "[Tool Result (Error)]\nNot found"],
		[
			"text, image and other blocks",
			{
				content: [
					text("Screenshot:"),
					{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
					{ type: "document" } as unknown as Anthropic.Messages.TextBlockParam,
				],
			},
			"[Tool Result]\nScreenshot:\n[Image]\n[document]",
		],
		["no content", {}, "[Tool Result]"],
	])("toolResultToText renders %s", (_label, fields, expected) => {
		expect(toolResultToText({ type: "tool_result", tool_use_id: "t", ...fields })).toBe(expected)
	})

	it("transformMessagesForCondensing turns tool blocks into text blocks without touching the input", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: [text("Let me look"), toolUse("t1")], ts: 2 },
			{ role: "user", content: [toolResult("t1", "file contents")], ts: 3 },
		]
		const snapshot = structuredClone(messages)

		const result = transformMessagesForCondensing(messages)

		expect(result).toEqual([
			messages[0],
			{ ...messages[1], content: [text("Let me look"), text("[Tool Use: read_file]\npath: t1.ts")] },
			{ ...messages[2], content: [text("[Tool Result]\nfile contents")] },
		])
		expect(messages).toEqual(snapshot)
	})
})
