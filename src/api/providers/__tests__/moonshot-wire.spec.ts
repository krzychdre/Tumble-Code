// API-4: what the Moonshot handler puts on the wire and what it makes of the answer.
//
// These tests stub the global `fetch` and look only at the HTTP request and at the
// chunks the handler yields, so they do not depend on which client library the
// handler uses. Most of them pin today's behavior (the handler must keep it when it
// moves from the Vercel AI SDK to the shared OpenAI-compatible base). The ones marked
// "DEF-C14" or "intended" pin the gaps of the AI SDK path that the move closes:
// no abort signal, no timeout, no usage request, reasoning not sent back, and cache
// figures read only from a legacy field. The incremental tool-call gap is pinned in
// moonshot-stream-errors.spec.ts.
//
// Reference: https://platform.kimi.ai/docs/api/chat.md (Chat Completions API).

const { timeoutState } = vi.hoisted(() => ({ timeoutState: { ms: 600_000 } }))

vi.mock("../utils/timeout-config", () => ({
	getApiRequestTimeout: () => timeoutState.ms,
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandlerCreateMessageMetadata } from "../../index"
import { MoonshotHandler } from "../moonshot"

type FetchCall = { url: string; body: any; headers: Headers; signal?: AbortSignal }

const systemPrompt = "You are a helpful assistant."
const userHello: Anthropic.Messages.MessageParam[] = [{ role: "user", content: [{ type: "text", text: "Hello!" }] }]

const readFileTool = {
	type: "function" as const,
	function: {
		name: "read_file",
		description: "Read a file",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},
}

function sse(events: Array<object | string>): Response {
	const body = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("")
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}

function json(body: object): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

const textChunk = (content: string) => ({
	id: "1",
	object: "chat.completion.chunk",
	choices: [{ index: 0, delta: { content } }],
})
const stopChunk = {
	id: "1",
	object: "chat.completion.chunk",
	choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
}
const usageChunk = (usage: object) => ({ id: "1", object: "chat.completion.chunk", choices: [], usage })

// Rejects when the request's signal aborts, and never settles without one.
function hangUntilAborted(_url: unknown, init?: RequestInit): Promise<Response> {
	return new Promise((_resolve, reject) => {
		const signal = init?.signal
		if (!signal) return
		if (signal.aborted) return reject(signal.reason ?? new Error("aborted"))
		signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")))
	})
}

async function drain(handler: MoonshotHandler, messages = userHello, metadata?: ApiHandlerCreateMessageMetadata) {
	const chunks: any[] = []
	let thrown: unknown
	try {
		for await (const chunk of handler.createMessage(systemPrompt, messages, metadata)) {
			chunks.push(chunk)
		}
	} catch (error) {
		thrown = error
	}
	return { chunks, thrown }
}

const HUNG = Symbol("hung")
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | typeof HUNG> {
	return Promise.race([promise, new Promise<typeof HUNG>((resolve) => setTimeout(() => resolve(HUNG), ms))])
}

describe("MoonshotHandler on the wire (API-4)", () => {
	let fetchMock: ReturnType<typeof vi.fn>
	let calls: FetchCall[]

	function makeHandler(options: Record<string, unknown> = {}) {
		return new MoonshotHandler({
			moonshotApiKey: "test-key",
			apiModelId: "kimi-k2-0905-preview",
			moonshotBaseUrl: "https://api.moonshot.ai/v1",
			...options,
		})
	}

	function respondWith(factory: () => Response | Promise<Response>) {
		fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
			calls.push({
				url: String(url instanceof Request ? url.url : url),
				body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
				headers: new Headers(init?.headers),
				signal: init?.signal ?? undefined,
			})
			return factory()
		})
	}

	beforeEach(() => {
		timeoutState.ms = 600_000
		calls = []
		fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
		respondWith(() =>
			sse([textChunk("ok"), stopChunk, usageChunk({ prompt_tokens: 1, completion_tokens: 1 }), "[DONE]"]),
		)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	describe("request (characterization)", () => {
		it("posts to <base URL>/chat/completions with the Moonshot key", async () => {
			await drain(makeHandler())

			expect(calls).toHaveLength(1)
			expect(calls[0].url).toBe("https://api.moonshot.ai/v1/chat/completions")
			expect(calls[0].headers.get("authorization")).toBe("Bearer test-key")
		})

		it("uses the international endpoint when no base URL is set", async () => {
			await drain(makeHandler({ moonshotBaseUrl: undefined }))

			expect(calls[0].url).toBe("https://api.moonshot.ai/v1/chat/completions")
		})

		it("uses the China endpoint when it is configured", async () => {
			await drain(makeHandler({ moonshotBaseUrl: "https://api.moonshot.cn/v1" }))

			expect(calls[0].url).toBe("https://api.moonshot.cn/v1/chat/completions")
		})

		it("sends model, max_tokens, temperature, a streaming flag and the system prompt first", async () => {
			await drain(makeHandler())

			const body = calls[0].body
			expect(body.model).toBe("kimi-k2-0905-preview")
			expect(body.max_tokens).toBe(16_384)
			expect(body.temperature).toBe(0)
			expect(body.stream).toBe(true)
			expect(body.messages).toEqual([
				{ role: "system", content: systemPrompt },
				// A text-only user message goes out as a plain string.
				{ role: "user", content: "Hello!" },
			])
		})

		it("uses the catalog default temperature of the model (kimi-k2.5: 1.0)", async () => {
			await drain(makeHandler({ apiModelId: "kimi-k2.5" }))

			expect(calls[0].body.temperature).toBe(1)
		})

		it("uses the user's temperature when one is set", async () => {
			await drain(makeHandler({ modelTemperature: 0.3 }))

			expect(calls[0].body.temperature).toBe(0.3)
		})

		it("keeps an unknown model id and sends it as typed", async () => {
			await drain(makeHandler({ apiModelId: "kimi-k9-future" }))

			expect(calls[0].body.model).toBe("kimi-k9-future")
		})

		it("sends tools in the OpenAI function format and maps tool_choice", async () => {
			await drain(makeHandler(), userHello, {
				taskId: "t",
				tools: [readFileTool],
				tool_choice: { type: "function", function: { name: "read_file" } },
			})

			const body = calls[0].body
			expect(body.tools).toHaveLength(1)
			expect(body.tools[0]).toMatchObject({
				type: "function",
				function: {
					name: "read_file",
					description: "Read a file",
					// The shared strict-schema conversion (additionalProperties: false) applies.
					parameters: {
						type: "object",
						properties: { path: { type: "string" } },
						required: ["path"],
						additionalProperties: false,
					},
				},
			})
			expect(body.tool_choice).toEqual({ type: "function", function: { name: "read_file" } })
		})

		it("sends no tools and no tool_choice when the task passes none", async () => {
			await drain(makeHandler())

			expect(calls[0].body.tools).toBeUndefined()
			expect(calls[0].body.tool_choice).toBeUndefined()
		})

		it("does not send parallel_tool_calls (not in the Moonshot request schema)", async () => {
			await drain(makeHandler(), userHello, { taskId: "t", tools: [readFileTool], parallelToolCalls: true })

			expect(calls[0].body).not.toHaveProperty("parallel_tool_calls")
		})

		it("sends tool results as tool messages after the assistant's tool call", async () => {
			const history: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Read a.ts" },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } }],
				},
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "export {}" }] },
			]

			await drain(makeHandler(), history)

			const messages = calls[0].body.messages
			expect(messages[2]).toMatchObject({
				role: "assistant",
				tool_calls: [
					{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
				],
			})
			expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "export {}" })
		})
	})

	describe("max_tokens after a model switch (DEF-C22)", () => {
		// Moonshot models have no max-output slider, so modelMaxTokens can only be a
		// leftover from another model; the shared rule caps it.
		const cases = [
			{ modelId: "kimi-k2-0711-preview", stale: 131_072, expected: 26_215 },
			{ modelId: "kimi-k2.5", stale: 131_072, expected: 16_384 },
		] as const

		for (const { modelId, stale, expected } of cases) {
			it(`caps a stale ${stale} to ${expected} for ${modelId} when streaming`, async () => {
				await drain(makeHandler({ apiModelId: modelId, modelMaxTokens: stale }))

				expect(calls[0].body.max_tokens).toBe(expected)
			})

			it(`caps a stale ${stale} to ${expected} for ${modelId} in completePrompt`, async () => {
				respondWith(() =>
					json({ id: "1", choices: [{ index: 0, message: { role: "assistant", content: "ok" } }] }),
				)

				await makeHandler({ apiModelId: modelId, modelMaxTokens: stale }).completePrompt("prompt")

				expect(calls[0].body.max_tokens).toBe(expected)
			})
		}
	})

	describe("response (characterization)", () => {
		it("yields streamed text in order", async () => {
			respondWith(() => sse([textChunk("Hel"), textChunk("lo"), stopChunk, "[DONE]"]))

			const { chunks, thrown } = await drain(makeHandler())

			expect(thrown).toBeUndefined()
			expect(chunks.filter((c) => c.type === "text").map((c) => c.text)).toEqual(["Hel", "lo"])
		})

		it("yields reasoning_content deltas as reasoning before the answer", async () => {
			respondWith(() =>
				sse([
					{ id: "1", choices: [{ index: 0, delta: { reasoning_content: "Think" } }] },
					{ id: "1", choices: [{ index: 0, delta: { reasoning_content: "ing." } }] },
					textChunk("Answer"),
					stopChunk,
					"[DONE]",
				]),
			)

			const { chunks } = await drain(makeHandler({ apiModelId: "kimi-k2-thinking" }))

			const visible = chunks.filter((c) => c.type === "reasoning" || c.type === "text")
			expect(visible.map((c) => [c.type, c.text])).toEqual([
				["reasoning", "Think"],
				["reasoning", "ing."],
				["text", "Answer"],
			])
		})

		it("reads usage from the final chunk, with cache reads from the top-level cached_tokens", async () => {
			respondWith(() =>
				sse([
					textChunk("ok"),
					stopChunk,
					usageChunk({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cached_tokens: 20 }),
					"[DONE]",
				]),
			)

			const { chunks } = await drain(makeHandler())

			const usage = chunks.filter((c) => c.type === "usage")
			expect(usage).toHaveLength(1)
			expect(usage[0]).toMatchObject({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 20 })
			expect(usage[0].cacheWriteTokens || 0).toBe(0)
		})

		it("AP-4: estimates usage locally, exactly once, when the server sends none", async () => {
			respondWith(() => sse([textChunk("Hello world response"), stopChunk, "[DONE]"]))
			const handler = makeHandler()
			const countTokens = vi.spyOn(handler, "countTokens").mockResolvedValue(42)

			const { chunks } = await drain(handler)

			const usage = chunks.filter((c) => c.type === "usage")
			expect(usage).toEqual([{ type: "usage", inputTokens: 42, outputTokens: 42 }])
			expect(countTokens).toHaveBeenCalledTimes(2)
		})

		it("AP-4: treats an all-zero usage block as missing", async () => {
			respondWith(() =>
				sse([
					textChunk("Response text"),
					stopChunk,
					usageChunk({ prompt_tokens: 0, completion_tokens: 0 }),
					"[DONE]",
				]),
			)
			const handler = makeHandler()
			vi.spyOn(handler, "countTokens").mockResolvedValue(15)

			const { chunks } = await drain(handler)

			expect(chunks.filter((c) => c.type === "usage")).toEqual([
				{ type: "usage", inputTokens: 15, outputTokens: 15 },
			])
		})

		it("AP-4: does not estimate when the server reports usage", async () => {
			respondWith(() =>
				sse([textChunk("ok"), stopChunk, usageChunk({ prompt_tokens: 10, completion_tokens: 5 }), "[DONE]"]),
			)
			const handler = makeHandler()
			const countTokens = vi.spyOn(handler, "countTokens").mockResolvedValue(999)

			const { chunks } = await drain(handler)

			const usage = chunks.filter((c) => c.type === "usage")
			expect(usage).toHaveLength(1)
			expect(usage[0]).toMatchObject({ inputTokens: 10, outputTokens: 5 })
			expect(countTokens).not.toHaveBeenCalled()
		})

		it("DEF-C16: the local estimate counts tool_result content, not only text", async () => {
			respondWith(() => sse([textChunk("ok"), stopChunk, "[DONE]"]))
			const handler = makeHandler()
			const countTokens = vi.spyOn(handler, "countTokens").mockResolvedValue(42)
			const fileBody = "export const a = 1\n".repeat(50)
			const history: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Read a.ts" },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } }],
				},
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: fileBody }] },
			]

			await drain(handler, history)

			const inputBlocks = countTokens.mock.calls[0][0]
			expect(inputBlocks[0]).toEqual({ type: "text", text: systemPrompt })
			expect(inputBlocks).toContainEqual(
				expect.objectContaining({ type: "tool_result", tool_use_id: "call_1", content: fileBody }),
			)
		})

		it("completePrompt returns the answer and its usage", async () => {
			respondWith(() =>
				json({
					id: "1",
					choices: [{ index: 0, message: { role: "assistant", content: "Test completion" } }],
					usage: { prompt_tokens: 7, completion_tokens: 3 },
				}),
			)

			const result = await makeHandler().completePromptWithUsage("Test prompt")

			expect(result.text).toBe("Test completion")
			expect(result.usage).toMatchObject({ inputTokens: 7, outputTokens: 3 })
			expect(calls[0].body.messages).toEqual([{ role: "user", content: "Test prompt" }])
			expect(calls[0].body.stream).toBeFalsy()
		})

		it("completePrompt sends a temperature only when the user set one", async () => {
			const reply = () =>
				json({ id: "1", choices: [{ index: 0, message: { role: "assistant", content: "ok" } }] })
			respondWith(reply)

			await makeHandler().completePrompt("p")
			await makeHandler({ modelTemperature: 0.3 }).completePrompt("p")

			expect(calls[0].body).not.toHaveProperty("temperature")
			expect(calls[1].body.temperature).toBe(0.3)
		})
	})

	describe("gaps of the AI SDK path (intended behavior, DEF-C14)", () => {
		it("asks for the usage chunk with stream_options.include_usage (the API sends none otherwise)", async () => {
			await drain(makeHandler())

			expect(calls[0].body.stream_options).toEqual({ include_usage: true })
		})

		it("reads cache reads and writes from prompt_tokens_details (the documented fields)", async () => {
			respondWith(() =>
				sse([
					textChunk("ok"),
					stopChunk,
					usageChunk({
						prompt_tokens: 100,
						completion_tokens: 50,
						prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 40 },
					}),
					"[DONE]",
				]),
			)

			const { chunks } = await drain(makeHandler())

			const usage = chunks.filter((c) => c.type === "usage")
			expect(usage).toHaveLength(1)
			expect(usage[0]).toMatchObject({
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 30,
				cacheWriteTokens: 40,
			})
		})

		it("passes an abort signal that cancelRequest() (the Stop button) aborts", async () => {
			fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
				calls.push({
					url: String(url),
					body: undefined,
					headers: new Headers(),
					signal: init?.signal ?? undefined,
				})
				return hangUntilAborted(url, init)
			})
			const handler = makeHandler()

			const pending = drain(handler)
			await vi.waitFor(() => expect(calls).toHaveLength(1))
			expect(calls[0].signal).toBeDefined()

			handler.cancelRequest?.()

			const result = await withDeadline(pending, 3_000)
			expect(result).not.toBe(HUNG)
			expect(calls[0].signal?.aborted).toBe(true)
			expect((result as Awaited<typeof pending>).thrown).toBeDefined()
		})

		it("honors the apiRequestTimeout setting instead of waiting forever", async () => {
			timeoutState.ms = 20
			fetchMock.mockImplementation(hangUntilAborted)
			const handler = makeHandler()

			// The client retries a timed-out request twice with a short backoff, so allow a few seconds.
			const result = await withDeadline(drain(handler), 8_000)

			expect(result).not.toBe(HUNG)
			expect((result as Awaited<ReturnType<typeof drain>>).thrown).toBeDefined()
		}, 12_000)

		it("sends the preserved reasoning back as reasoning_content on the assistant tool call (kimi-k2-thinking)", async () => {
			// With preserveReasoning the task keeps the reasoning block in the assistant
			// message; Moonshot expects it back as reasoning_content during a tool loop.
			const history = [
				{ role: "user", content: "Read a.ts" },
				{
					role: "assistant",
					content: [
						{ type: "reasoning", text: "I should read the file." },
						{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } },
					],
				},
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "export {}" }] },
			] as unknown as Anthropic.Messages.MessageParam[]

			await drain(makeHandler({ apiModelId: "kimi-k2-thinking" }), history)

			const assistant = calls[0].body.messages.find((m: any) => m.role === "assistant")
			expect(assistant).toMatchObject({
				reasoning_content: "I should read the file.",
				tool_calls: [{ id: "call_1", function: { name: "read_file" } }],
			})
		})
	})
})
