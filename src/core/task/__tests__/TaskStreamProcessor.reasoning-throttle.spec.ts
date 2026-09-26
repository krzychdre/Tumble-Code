// cd src && ./node_modules/.bin/vitest run core/task/__tests__/TaskStreamProcessor.reasoning-throttle.spec.ts

// Every streamed reasoning chunk posted the WHOLE reasoning so far to the
// webview (a "messageUpdated" of the partial "reasoning" say), so a long
// reasoning posted a quadratic number of bytes (left open by API P3, #461).
// The partial updates are now posted at most once per interval, the rule API
// P2 (#456) applied to streamed tool arguments. These tests pin that only the
// number of intermediate partial posts drops: the first chunk is shown at
// once, pending text is posted before any other message, on abort, on stream
// error and on completion, the final message carries the complete text, and
// the messages and final posts are the same as an unthrottled stream.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ClineMessage } from "@roo-code/types"

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { capture: vi.fn() } },
}))

vi.mock("../../assistant-message", () => ({
	presentAssistantMessage: vi.fn(),
}))

import { presentAssistantMessage } from "../../assistant-message"
import { TaskStreamProcessor, type TaskStreamProcessorAccess } from "../TaskStreamProcessor"
import { TaskAskSay } from "../TaskAskSay"
import { formatReasoningText } from "../reasoningFormatter"
import { PARTIAL_ARGS_PARSE_INTERVAL_MS } from "../../assistant-message/NativeToolCallParser"

/** One post of a message to the webview (a state push for a new message, a messageUpdated otherwise). */
interface Post {
	kind: "created" | "updated"
	ts: number
	say?: string
	text?: string
	partial?: boolean
}

function makeHarness() {
	const posts: Post[] = []
	const record = (kind: Post["kind"], message: ClineMessage) =>
		posts.push({ kind, ts: message.ts, say: message.say, text: message.text, partial: message.partial })

	const access = {
		taskId: "task-reasoning-throttle",
		instanceId: "inst-1",
		abort: false,
		abandoned: false,
		apiConfiguration: { apiProvider: "openrouter" } as any,
		currentStreamingContentIndex: 0,
		currentStreamingDidCheckpoint: false,
		assistantMessageContent: [],
		didCompleteReadingStream: false,
		userMessageContent: [],
		userMessageContentReady: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		didToolFailInCurrentTurn: false,
		assistantMessageSavedToHistory: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		streamingToolCallIndices: new Map<string, number>(),
		isStreaming: false,
		isWaitingForFirstChunk: false,
		clineMessages: [] as ClineMessage[],
		didFinishAbortingStream: false,
		consecutiveNoAssistantMessagesCount: 0,
		lastMessageTs: undefined as number | undefined,
		api: { getModel: () => ({ id: "test-model", info: { contextWindow: 200000 } }) } as any,
		history: {
			addToClineMessages: vi.fn(async (message: ClineMessage) => {
				access.clineMessages.push(message)
				record("created", message)
			}),
			updateClineMessage: vi.fn(async (message: ClineMessage) => record("updated", message)),
			saveClineMessages: vi.fn().mockResolvedValue(true),
			addToApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		} as any,
		providerRef: { deref: () => ({ postStateToWebviewWithoutTaskHistory: vi.fn() }) } as any,
		emit: vi.fn(),
		pushToolResultToUserContent: vi.fn().mockReturnValue(true),
		diffViewProvider: { reset: vi.fn().mockResolvedValue(undefined), isEditing: false } as any,
	} as any
	access.askSay = new TaskAskSay(access)

	// The real presentAssistantMessage shows a streamed text block as a partial "text" say.
	vi.mocked(presentAssistantMessage).mockImplementation(() => {
		const block = access.assistantMessageContent.at(-1)
		if (block?.type === "text") {
			void access.askSay.say("text", block.content, undefined, block.partial)
		}
		return Promise.resolve()
	})

	const processor = new TaskStreamProcessor(access as TaskStreamProcessorAccess, access)
	return { access, processor, posts }
}

const modelInfo = { contextWindow: 200000, supportsPromptCache: false } as any

/** Splits `text` into chunks of `size` characters, like a token stream. */
function chunksOf(text: string, size: number): string[] {
	const chunks: string[] = []
	for (let i = 0; i < text.length; i += size) {
		chunks.push(text.slice(i, i + size))
	}
	return chunks
}

/** A 44 KB reasoning with section titles glued to sentence ends, streamed in 4-character chunks. */
const longReasoning = Array.from(
	{ length: 500 },
	(_, i) => `Step ${i}: the model reads the code and checks the tests.**Plan ${i}** it edits the file.\n`,
).join("")

type Step = { reasoning: string } | { text: string }

/** Streams `steps` with `gapMs` between chunks and finishes the stream; returns what was posted. */
async function runStream(steps: Step[], gapMs: number, chunkSize = 4) {
	const harness = makeHarness()
	await harness.processor.resetStreamingState()
	for (const step of steps) {
		const [type, text] = "reasoning" in step ? ["reasoning", step.reasoning] : ["text", step.text]
		for (const chunk of chunksOf(text, chunkSize)) {
			await vi.advanceTimersByTimeAsync(gapMs)
			harness.processor.processChunk({ type, text: chunk }, modelInfo)
		}
	}
	await harness.processor.finalizeStream()
	return harness
}

const reasoningPosts = (posts: Post[]) => posts.filter((post) => post.say === "reasoning")
const bytes = (posts: Post[]) => posts.reduce((sum, post) => sum + (post.text?.length ?? 0), 0)

/** The messages without their timestamps (a throttled and an unthrottled run differ only in ts). */
const withoutTs = (messages: ClineMessage[]) => messages.map(({ ts: _ts, ...rest }) => rest)

describe("TaskStreamProcessor partial reasoning posts", () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: 1_000_000 })
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("uses the tool-argument preview interval (API P2)", async () => {
		const { REASONING_PARTIAL_POST_INTERVAL_MS } = await import("../TaskStreamProcessor")
		expect(REASONING_PARTIAL_POST_INTERVAL_MS).toBe(PARTIAL_ARGS_PARSE_INTERVAL_MS)
	})

	it("posts a 44 KB reasoning at most once per interval, the first chunk at once and the complete text at the end", async () => {
		const chunkCount = Math.ceil(longReasoning.length / 4)
		// 5 ms per chunk (200 chunks per second, 800 characters per second).
		const { access, posts } = await runStream([{ reasoning: longReasoning }], 5)
		const reasoning = reasoningPosts(posts)

		// The first chunk creates the message at once.
		expect(reasoning[0]).toMatchObject({ kind: "created", text: longReasoning.slice(0, 4), partial: true })

		// Before: one post of the whole text so far per chunk, 10,946 posts and
		// 245.1 million characters. After: about one per interval, 550 posts and
		// 12.4 million characters.
		const streamMs = chunkCount * 5
		expect(reasoning.length).toBeLessThanOrEqual(streamMs / PARTIAL_ARGS_PARSE_INTERVAL_MS + 5)
		expect(bytes(reasoning)).toBeLessThan(15_000_000)

		// The last partial post and the final post carry the complete text.
		const complete = formatReasoningText(longReasoning)
		expect(reasoning.at(-2)).toMatchObject({ text: complete, partial: true })
		expect(reasoning.at(-1)).toMatchObject({ kind: "updated", text: complete, partial: false })
		expect(access.clineMessages).toHaveLength(1)
		expect(access.clineMessages[0]).toMatchObject({ say: "reasoning", text: complete, partial: false })

		// Every post shows a longer start of the reasoning: nothing reordered or
		// lost in between (undoing the title formatting, which the text never contains).
		const unformat = (text: string) => text.replace(/([.!?])\n\n\*\*/g, "$1**")
		let shown = 0
		for (const post of reasoning) {
			const raw = unformat(post.text!)
			expect(longReasoning.startsWith(raw)).toBe(true)
			expect(raw.length).toBeGreaterThanOrEqual(shown)
			shown = raw.length
		}
		expect(vi.getTimerCount()).toBe(0)
	})

	it("keeps the in-memory message complete after every chunk, so a save at any moment writes the full text", async () => {
		const { access, processor } = makeHarness()
		await processor.resetStreamingState()

		let streamed = ""
		for (const chunk of chunksOf(longReasoning.slice(0, 2_000), 4)) {
			await vi.advanceTimersByTimeAsync(5)
			processor.processChunk({ type: "reasoning", text: chunk }, modelInfo)
			streamed += chunk
			expect(access.clineMessages.at(-1)?.text).toBe(formatReasoningText(streamed))
		}
	})

	it("posts deferred text within one interval when the stream stalls, and leaves no timer behind", async () => {
		const { processor, posts } = makeHarness()
		await processor.resetStreamingState()

		processor.processChunk({ type: "reasoning", text: "First " }, modelInfo)
		await vi.advanceTimersByTimeAsync(10)
		processor.processChunk({ type: "reasoning", text: "second " }, modelInfo)
		expect(reasoningPosts(posts).map((post) => post.text)).toEqual(["First "])

		// The stream goes quiet: the deferred text is posted when the interval ends.
		await vi.advanceTimersByTimeAsync(PARTIAL_ARGS_PARSE_INTERVAL_MS)
		expect(reasoningPosts(posts).map((post) => post.text)).toEqual(["First ", "First second "])
		expect(vi.getTimerCount()).toBe(0)
	})

	it("posts pending reasoning before a text message starts, and interleaved reasoning still works", async () => {
		const { access, posts } = await runStream(
			[{ reasoning: "Thinking about the first part.\n" }, { text: "Here is " }, { reasoning: "More.**Next** thoughts" }],
			5,
			2,
		)

		// The first reasoning message got its complete text before the text message was created.
		const textCreated = posts.findIndex((post) => post.say === "text" && post.kind === "created")
		const beforeText = reasoningPosts(posts.slice(0, textCreated))
		expect(beforeText.at(-1)?.text).toBe("Thinking about the first part.\n")

		// Interleaved: reasoning, text, reasoning, as today (the second message
		// carries the whole reasoning of the request).
		expect(access.clineMessages.map((m: ClineMessage) => [m.say, m.text, m.partial])).toEqual([
			["reasoning", "Thinking about the first part.\n", true],
			["text", "Here is ", true],
			["reasoning", formatReasoningText("Thinking about the first part.\nMore.**Next** thoughts"), false],
		])
		expect(vi.getTimerCount()).toBe(0)
	})

	it("produces the same messages and the same last post per message as an unthrottled stream", async () => {
		const steps: Step[] = [
			{ reasoning: longReasoning.slice(0, 3_000) },
			{ text: "Let me look at the file. " },
			{ reasoning: longReasoning.slice(3_000, 5_000) },
			{ text: "Done." },
		]

		// Chunks further apart than the interval are never throttled: this is today's behavior.
		const unthrottled = await runStream(steps, PARTIAL_ARGS_PARSE_INTERVAL_MS + 1, 3)
		const throttled = await runStream(steps, 2, 3)

		expect(throttled.posts.length).toBeLessThan(unthrottled.posts.length / 10)
		expect(withoutTs(throttled.access.clineMessages)).toEqual(withoutTs(unthrottled.access.clineMessages))

		// Per message (in creation order): the last partial post and the final
		// post are the same, so the webview, the CLI and the cloud end up with
		// the same content.
		const lastPosts = (posts: Post[]) => {
			const byMessage = new Map<number, { lastPartial?: Omit<Post, "ts">; final?: Omit<Post, "ts"> }>()
			for (const { ts, ...post } of posts) {
				const entry = byMessage.get(ts) ?? {}
				entry[post.partial ? "lastPartial" : "final"] = post
				byMessage.set(ts, entry)
			}
			return [...byMessage.values()]
		}
		expect(lastPosts(throttled.posts)).toEqual(lastPosts(unthrottled.posts))
	})

	it.each([
		["a user cancel", "user_cancelled", undefined],
		["a stream error", "streaming_failed", "Stream terminated by provider: boom"],
	] as const)("posts pending reasoning before %s closes the message", async (_name, reason, failure) => {
		const { access, processor, posts } = makeHarness()
		await processor.resetStreamingState()
		access.clineMessages.push({ ts: 1, type: "say", say: "api_req_started", text: "{}" })
		const abortStream = processor.createAbortStreamFn(0, vi.fn())

		processor.processChunk({ type: "reasoning", text: "Thinking " }, modelInfo)
		await vi.advanceTimersByTimeAsync(10)
		processor.processChunk({ type: "reasoning", text: "harder" }, modelInfo)
		if (reason === "user_cancelled") {
			access.abort = true
		}
		await abortStream(reason, failure)

		// Today the last chunk posted the whole text as a partial update; it still does.
		expect(reasoningPosts(posts).at(-1)).toMatchObject({ text: "Thinking harder", partial: true })
		expect(access.clineMessages.at(-1)).toMatchObject({ text: "Thinking harder", partial: false })
		expect(vi.getTimerCount()).toBe(0)
	})

	it("leaves no timer behind when the task is disposed mid-stream", async () => {
		const { processor, posts } = makeHarness()
		await processor.resetStreamingState()

		processor.processChunk({ type: "reasoning", text: "a" }, modelInfo)
		processor.processChunk({ type: "reasoning", text: "b" }, modelInfo)
		processor.dispose()

		expect(vi.getTimerCount()).toBe(0)
		await vi.advanceTimersByTimeAsync(PARTIAL_ARGS_PARSE_INTERVAL_MS * 2)
		expect(reasoningPosts(posts)).toHaveLength(1)
	})
})
