// npx vitest run api/__tests__/BackgroundModelHandler.spec.ts
// Run from the `src` workspace: cd src && npx vitest run api/__tests__/BackgroundModelHandler.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../index"
import type { ApiStream, ApiStreamChunk } from "../transform/stream"

import { BackgroundModelHandler, isFallbackTriggerError, type FallbackSink } from "../BackgroundModelHandler"

/** Build an async generator that yields the given chunks. */
async function* gen(chunks: ApiStreamChunk[]): ApiStream {
	for (const c of chunks) yield c
}

/** A minimal mock ApiHandler for tests. */
function mockHandler(opts: {
	id?: string
	createMessage?: ApiHandler["createMessage"] | "throw-trigger" | "throw-nontrigger"
	countTokens?: number
	model?: { id: string; info: any }
	cancelRequest?: (destroyClient?: boolean) => void
}): ApiHandler & {
	createMessageCalls: Array<{ system: string; messages: any[]; metadata?: any }>
	countTokensCalls: number
} {
	const calls: Array<{ system: string; messages: any[]; metadata?: any }> = []
	let countTokensCalls = 0
	const handler: any = {
		createMessageCalls: calls,
		countTokensCalls,
		getModel: () =>
			opts.model ?? {
				id: opts.id ?? "mock-model",
				info: { contextWindow: 200_000, supportsImages: false, supportsPromptCache: false },
			},
		countTokens: async (_content: Array<Anthropic.Messages.ContentBlockParam>) => {
			countTokensCalls++
			handler.countTokensCalls = countTokensCalls
			return opts.countTokens ?? 42
		},
	}
	if (opts.createMessage === "throw-trigger") {
		handler.createMessage = (
			_system: string,
			_messages: Anthropic.Messages.MessageParam[],
			_metadata?: ApiHandlerCreateMessageMetadata,
		): ApiStream => {
			// Synchronous throw of a trigger error. (Real providers throw at
			// the first next() inside the consumer; a sync throw is a superset
			// the buffered-fallback wrapper must also handle.)
			throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNRESET" })
		}
	} else if (opts.createMessage === "throw-nontrigger") {
		handler.createMessage = (
			_system: string,
			_messages: Anthropic.Messages.MessageParam[],
			_metadata?: ApiHandlerCreateMessageMetadata,
		): ApiStream => {
			throw new Error("programmer error")
		}
	} else if (typeof opts.createMessage === "function") {
		const impl = opts.createMessage
		handler.createMessage = (
			system: string,
			messages: Anthropic.Messages.MessageParam[],
			metadata?: ApiHandlerCreateMessageMetadata,
		): ApiStream => {
			calls.push({ system, messages, metadata })
			return impl(system, messages, metadata)
		}
	} else {
		// Default: a stream yielding a single text chunk "from <id>".
		handler.createMessage = (
			system: string,
			messages: Anthropic.Messages.MessageParam[],
			metadata?: ApiHandlerCreateMessageMetadata,
		): ApiStream => {
			calls.push({ system, messages, metadata })
			return gen([{ type: "text", text: `from ${opts.id ?? "mock"}` }])
		}
	}
	if (opts.cancelRequest) handler.cancelRequest = opts.cancelRequest
	return handler as any
}

describe("isFallbackTriggerError", () => {
	it("returns true for network connectivity errors", () => {
		expect(isFallbackTriggerError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true)
		expect(isFallbackTriggerError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe(true)
		expect(isFallbackTriggerError(Object.assign(new Error("dns"), { code: "ENOTFOUND" }))).toBe(true)
		expect(isFallbackTriggerError(Object.assign(new Error("again"), { code: "EAI_AGAIN" }))).toBe(true)
	})

	it("returns true for auth errors 401/403", () => {
		expect(isFallbackTriggerError(Object.assign(new Error("unauth"), { status: 401 }))).toBe(true)
		expect(isFallbackTriggerError(Object.assign(new Error("forbidden"), { status: 403 }))).toBe(true)
	})

	it("returns true for rate limit / unavailable / 5xx", () => {
		expect(isFallbackTriggerError(Object.assign(new Error("rate"), { status: 429 }))).toBe(true)
		expect(isFallbackTriggerError(Object.assign(new Error("unavail"), { status: 503 }))).toBe(true)
		expect(isFallbackTriggerError(Object.assign(new Error("boom"), { status: 500 }))).toBe(true)
		expect(isFallbackTriggerError(Object.assign(new Error("boom"), { status: 502 }))).toBe(true)
		expect(isFallbackTriggerError(Object.assign(new Error("boom"), { status: 599 }))).toBe(true)
	})

	it("returns true for 400 (background rejects payload — e.g. context_length_exceeded, unsupported images)", () => {
		expect(isFallbackTriggerError(Object.assign(new Error("context_length_exceeded"), { status: 400 }))).toBe(true)
		expect(
			isFallbackTriggerError(
				Object.assign(new Error("Invalid request: text content blocks must be non-empty"), { status: 400 }),
			),
		).toBe(true)
	})

	it("returns false for abort / generic / null / 404", () => {
		const abortErr: any = new Error("aborted")
		abortErr.name = "AbortError"
		expect(isFallbackTriggerError(abortErr)).toBe(false)
		expect(isFallbackTriggerError(new Error("boom"))).toBe(false)
		expect(isFallbackTriggerError(null)).toBe(false)
		expect(isFallbackTriggerError(undefined)).toBe(false)
		// 404 without a matching message regex is NOT a trigger.
		expect(isFallbackTriggerError(Object.assign(new Error("not found"), { status: 404 }))).toBe(false)
	})
})

describe("BackgroundModelHandler", () => {
	describe("passthrough (no background configured)", () => {
		it("createMessage returns the fallback's stream verbatim", async () => {
			const fb = mockHandler({ id: "fallback" })
			const wrapper = new BackgroundModelHandler({ fallback: fb })
			const stream = wrapper.createMessage("sys", [], { taskId: "t1" })
			const out: string[] = []
			for await (const c of stream) if (c.type === "text") out.push(c.text)
			expect(out).toEqual(["from fallback"])
			expect(fb.createMessageCalls).toHaveLength(1)
			expect(fb.createMessageCalls[0]).toEqual({ system: "sys", messages: [], metadata: { taskId: "t1" } })
		})

		it("countTokens delegates to fallback", async () => {
			const fb = mockHandler({ id: "fallback", countTokens: 7 })
			const wrapper = new BackgroundModelHandler({ fallback: fb })
			await expect(wrapper.countTokens([{ type: "text", text: "hi" }])).resolves.toBe(7)
			expect(fb.countTokensCalls).toBe(1)
		})

		it("getModel returns fallback's model", () => {
			const fb = mockHandler({ id: "fallback", model: { id: "fb-id", info: { contextWindow: 1 } } })
			const wrapper = new BackgroundModelHandler({ fallback: fb })
			expect(wrapper.getModel()).toEqual({ id: "fb-id", info: { contextWindow: 1 } })
		})
	})

	describe("with a background handler present", () => {
		it("getModel and countTokens use the BACKGROUND handler (payload must match the model that receives the request)", async () => {
			const bg = mockHandler({
				id: "background",
				model: { id: "bg-id", info: { contextWindow: 999 } },
				countTokens: 111,
			})
			const fb = mockHandler({
				id: "fallback",
				model: { id: "fb-id", info: { contextWindow: 200 } },
				countTokens: 222,
			})
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb })
			// getModel reports the background model so capability/window checks
			// (supportsImages, contextWindow) match the model that gets the call.
			expect(wrapper.getModel().id).toBe("bg-id")
			await expect(wrapper.countTokens([{ type: "text", text: "x" }])).resolves.toBe(111)
			expect(bg.countTokensCalls).toBe(1)
			expect(fb.countTokensCalls).toBe(0)
		})

		it("createMessage prefers the background handler when it succeeds", async () => {
			const bg = mockHandler({ id: "background" })
			const fb = mockHandler({ id: "fallback" })
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb })
			const stream = wrapper.createMessage("sys", [{ role: "user", content: "q" }], { taskId: "t2" })
			const out: string[] = []
			for await (const c of stream) if (c.type === "text") out.push(c.text)
			expect(out).toEqual(["from background"])
			expect(bg.createMessageCalls).toHaveLength(1)
			expect(fb.createMessageCalls).toHaveLength(0)
			expect(bg.createMessageCalls[0].system).toBe("sys")
			expect(bg.createMessageCalls[0].messages).toEqual([{ role: "user", content: "q" }])
		})

		it("on synchronous trigger error, calls onFallback and retries on fallback with the SAME args", async () => {
			const onFallback = vi.fn<FallbackSink>()
			const bg = mockHandler({ id: "background", createMessage: "throw-trigger" })
			const fb = mockHandler({ id: "fallback" })
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb, onFallback })
			const stream = wrapper.createMessage("sys", [{ role: "user", content: "q" }], { taskId: "t3" })
			const out: string[] = []
			for await (const c of stream) if (c.type === "text") out.push(c.text)
			expect(out).toEqual(["from fallback"])
			expect(onFallback).toHaveBeenCalledTimes(1)
			expect(onFallback.mock.calls[0][0]).toMatchObject({ stage: "createMessage" })
			// Fallback called with identical args.
			expect(fb.createMessageCalls).toHaveLength(1)
			expect(fb.createMessageCalls[0]).toEqual({
				system: "sys",
				messages: [{ role: "user", content: "q" }],
				metadata: { taskId: "t3" },
			})
		})

		it("on mid-stream trigger error, discards partial background output and replays on fallback", async () => {
			const onFallback = vi.fn<FallbackSink>()
			// Background yields one text chunk then throws a trigger error
			// mid-flight (simulates a provider dropping after partial output).
			const bg = mockHandler({
				id: "background",
				createMessage: () =>
					(async function* () {
						yield { type: "text" as const, text: "partial-" }
						throw Object.assign(new Error("unavail"), { status: 503 })
					})(),
			})
			const fb = mockHandler({ id: "fallback" })
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb, onFallback })
			const stream = wrapper.createMessage("sys", [{ role: "user", content: "q" }], { taskId: "t4" })
			const out: string[] = []
			for await (const c of stream) if (c.type === "text") out.push(c.text)
			// The partial background chunk is discarded; only the fallback's
			// complete output reaches the consumer.
			expect(out).toEqual(["from fallback"])
			expect(out).not.toContain("partial-")
			expect(onFallback).toHaveBeenCalledTimes(1)
			expect(fb.createMessageCalls).toHaveLength(1)
		})

		it("mid-stream fallback preserves the fallback's usage chunk (cost tracking)", async () => {
			const onFallback = vi.fn<FallbackSink>()
			const bg = mockHandler({
				id: "background",
				createMessage: () =>
					(async function* () {
						yield { type: "text" as const, text: "partial-" }
						throw Object.assign(new Error("unavail"), { status: 503 })
					})(),
			})
			const fb = mockHandler({
				id: "fallback",
				createMessage: () =>
					(async function* () {
						yield { type: "text" as const, text: "from fallback" }
						yield {
							type: "usage" as const,
							inputTokens: 10,
							outputTokens: 5,
							totalCost: 0.05,
						}
					})(),
			})
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb, onFallback })
			const stream = wrapper.createMessage("sys", [])
			let cost = 0
			for await (const c of stream) if (c.type === "usage" && c.totalCost != null) cost = c.totalCost
			expect(cost).toBe(0.05)
		})

		it("folds the discarded background attempt's cost into the fallback's usage (failed-attempt spend is billed too)", async () => {
			// Background emits usage (real billed spend, e.g. Anthropic's
			// cumulative message_delta) BEFORE failing mid-stream.
			const bg = mockHandler({
				id: "background",
				createMessage: () =>
					(async function* () {
						yield { type: "text" as const, text: "partial-" }
						yield { type: "usage" as const, inputTokens: 100, outputTokens: 20, totalCost: 0.02 }
						throw Object.assign(new Error("unavail"), { status: 503 })
					})(),
			})
			const fb = mockHandler({
				id: "fallback",
				createMessage: () =>
					(async function* () {
						yield { type: "text" as const, text: "from fallback" }
						yield { type: "usage" as const, inputTokens: 10, outputTokens: 5, totalCost: 0.05 }
					})(),
			})
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb })
			const stream = wrapper.createMessage("sys", [])
			let cost = 0
			for await (const c of stream) if (c.type === "usage" && c.totalCost != null) cost = c.totalCost
			// Consumer takes the LAST usage chunk's total — it must cover BOTH
			// the failed background attempt and the fallback call.
			expect(cost).toBeCloseTo(0.07)
		})

		it("emits a synthetic usage chunk for the background spend when the fallback emits no usage at all", async () => {
			const bg = mockHandler({
				id: "background",
				createMessage: () =>
					(async function* () {
						yield { type: "usage" as const, inputTokens: 100, outputTokens: 20, totalCost: 0.02 }
						throw Object.assign(new Error("unavail"), { status: 503 })
					})(),
			})
			const fb = mockHandler({ id: "fallback" }) // default stream: text only, no usage
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb })
			const stream = wrapper.createMessage("sys", [])
			const usage: number[] = []
			const out: string[] = []
			for await (const c of stream) {
				if (c.type === "usage" && c.totalCost != null) usage.push(c.totalCost)
				if (c.type === "text") out.push(c.text)
			}
			expect(out).toEqual(["from fallback"])
			expect(usage).toEqual([0.02])
		})

		it("on non-trigger error, re-throws and does NOT call fallback", async () => {
			const onFallback = vi.fn<FallbackSink>()
			const bg = mockHandler({ id: "background", createMessage: "throw-nontrigger" })
			const fb = mockHandler({ id: "fallback" })
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb, onFallback })
			const stream = wrapper.createMessage("sys", [])
			// Non-trigger errors surface inside the consumer's for-await (the
			// wrapper buffers, so the throw is observed during consumption).
			await expect(async () => {
				for await (const _c of stream) {
					// drain
				}
			}).rejects.toThrow("programmer error")
			expect(onFallback).not.toHaveBeenCalled()
			expect(fb.createMessageCalls).toHaveLength(0)
		})

		it("400 from background (context_length_exceeded) triggers fallback — the target cheap-model config", async () => {
			const onFallback = vi.fn<FallbackSink>()
			const bg = mockHandler({
				id: "background",
				createMessage: () =>
					(async function* () {
						// A 400 surfaces at the first chunk (the provider rejects
						// the payload before emitting any content). Yield a
						// placeholder so the generator has a yield (eslint),
						// then throw — the placeholder is discarded by the
						// wrapper's buffered fallback.
						yield { type: "text" as const, text: "" }
						throw Object.assign(new Error("context_length_exceeded"), { status: 400 })
					})(),
			})
			const fb = mockHandler({ id: "fallback" })
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb, onFallback })
			const stream = wrapper.createMessage("sys", [])
			const out: string[] = []
			for await (const c of stream) if (c.type === "text") out.push(c.text)
			expect(out).toEqual(["from fallback"])
			expect(onFallback).toHaveBeenCalledTimes(1)
			expect(fb.createMessageCalls).toHaveLength(1)
		})
	})

	describe("cancelRequest", () => {
		it("calls cancelRequest on both handlers when present", () => {
			const bgCancel = vi.fn()
			const fbCancel = vi.fn()
			const bg = mockHandler({ id: "background", cancelRequest: bgCancel })
			const fb = mockHandler({ id: "fallback", cancelRequest: fbCancel })
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb })
			wrapper.cancelRequest?.(true)
			expect(bgCancel).toHaveBeenCalledWith(true)
			expect(fbCancel).toHaveBeenCalledWith(true)
		})

		it("calls only the fallback's cancelRequest when background is absent", () => {
			const fbCancel = vi.fn()
			const fb = mockHandler({ id: "fallback", cancelRequest: fbCancel })
			const wrapper = new BackgroundModelHandler({ fallback: fb })
			wrapper.cancelRequest?.()
			expect(fbCancel).toHaveBeenCalledTimes(1)
		})
	})

	describe("getters", () => {
		it("exposes fallback and background readonly", () => {
			const bg = mockHandler({ id: "background" })
			const fb = mockHandler({ id: "fallback" })
			const wrapper = new BackgroundModelHandler({ background: bg, fallback: fb })
			expect(wrapper.fallback).toBe(fb)
			expect(wrapper.background).toBe(bg)
		})

		it("background getter is undefined when not configured", () => {
			const fb = mockHandler({ id: "fallback" })
			const wrapper = new BackgroundModelHandler({ fallback: fb })
			expect(wrapper.background).toBeUndefined()
			expect(wrapper.fallback).toBe(fb)
		})
	})
})
