// cd src && ./node_modules/.bin/vitest run api/__tests__/model-request-limiter.spec.ts

import type { ProviderSettings } from "@tumble-code/types"

import { buildApiHandler, type ApiHandler, type ApiHandlerCreateMessageMetadata, type CompletionResult } from "../index"
import { limitModelRequests, ModelRequestWaitAbortedError } from "../model-request-limiter"
import type { ApiStream } from "../transform/stream"

/**
 * A provider whose requests stay open until the test finishes them: each
 * request that reaches it pushes its finish function to `requests`. Its
 * completePrompt delegates to completePromptWithUsage, as every real provider's does.
 */
class HeldProvider {
	constructor(
		private readonly modelId: string,
		private readonly requests: Array<{ finish: () => void }>,
	) {}

	private hold(): Promise<void> {
		return new Promise<void>((finish) => this.requests.push({ finish }))
	}

	async *createMessage(
		_system = "",
		_messages: unknown[] = [],
		_metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		await this.hold()
		yield { type: "text", text: "done" }
	}

	getModel() {
		return { id: this.modelId, info: { contextWindow: 1000, supportsPromptCache: false } }
	}

	async countTokens() {
		return 0
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	async completePromptWithUsage(_prompt: string): Promise<CompletionResult> {
		await this.hold()
		return { text: "done" }
	}
}

let nextModel = 0

/** Handlers of one model (a fresh model per test, the limiter is process-wide). */
function modelHandlers(...limits: Array<number | undefined>) {
	const modelId = `model-${++nextModel}`
	const requests: Array<{ finish: () => void }> = []
	const handlers = limits.map((maxConcurrentRequests) => {
		const handler = new HeldProvider(modelId, requests)
		limitModelRequests(
			handler as unknown as ApiHandler,
			{
				apiProvider: "openai",
				maxConcurrentRequests,
			} as ProviderSettings,
		)
		return handler
	})
	return { requests, handlers }
}

const drain = async (stream: ApiStream) => {
	for await (const _chunk of stream) {
		// read to the end
	}
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

describe("limitModelRequests", () => {
	it("makes a request wait while its model runs maxConcurrentRequests, across handlers and request kinds", async () => {
		const { requests, handlers } = modelHandlers(2, 2, 2)
		const first = drain(handlers[0].createMessage())
		const second = handlers[1].completePromptWithUsage("p")
		const third = drain(handlers[2].createMessage())
		await tick()
		expect(requests).toHaveLength(2)

		requests[0].finish()
		await first
		await vi.waitFor(() => expect(requests).toHaveLength(3))

		requests[1].finish()
		requests[2].finish()
		await Promise.all([second, third])
	})

	it("counts the requests of a profile without a limit against the model's limited profiles", async () => {
		const { requests, handlers } = modelHandlers(undefined, 1)
		const unlimited = drain(handlers[0].createMessage())
		await tick()
		const limited = drain(handlers[1].createMessage())
		await tick()
		expect(requests).toHaveLength(1)

		requests[0].finish()
		await unlimited
		await vi.waitFor(() => expect(requests).toHaveLength(2))
		requests[1].finish()
		await limited
	})

	it("lets requests of another model run", async () => {
		const a = modelHandlers(1)
		const b = modelHandlers(1)
		const runA = drain(a.handlers[0].createMessage())
		const runB = drain(b.handlers[0].createMessage())
		await tick()
		expect(a.requests).toHaveLength(1)
		expect(b.requests).toHaveLength(1)
		a.requests[0].finish()
		b.requests[0].finish()
		await Promise.all([runA, runB])
	})

	it("takes one slot for completePrompt, which goes through completePromptWithUsage", async () => {
		const { requests, handlers } = modelHandlers(1)
		const completion = handlers[0].completePrompt("p")
		await tick()
		expect(requests).toHaveLength(1)
		requests[0].finish()
		await expect(completion).resolves.toBe("done")
	})

	it("gives the slot back when the reader stops the stream early", async () => {
		const { requests, handlers } = modelHandlers(1)
		const stopped = handlers[0].createMessage()
		const firstChunk = stopped.next()
		await tick()
		requests[0].finish()
		await firstChunk
		await stopped.return(undefined)

		const next = drain(handlers[0].createMessage())
		await vi.waitFor(() => expect(requests).toHaveLength(2))
		requests[1].finish()
		await next
	})

	it("stops a waiting request on its abort signal without taking a slot", async () => {
		const { requests, handlers } = modelHandlers(1)
		const running = drain(handlers[0].createMessage())
		await tick()
		const controller = new AbortController()
		const waiting = drain(handlers[0].createMessage("", [], { taskId: "t", signal: controller.signal }))
		await tick()

		controller.abort()
		await expect(waiting).rejects.toBeInstanceOf(ModelRequestWaitAbortedError)

		requests[0].finish()
		await running
		const after = drain(handlers[0].createMessage())
		await vi.waitFor(() => expect(requests).toHaveLength(2))
		requests[1].finish()
		await after
	})
})

describe("buildApiHandler", () => {
	it("routes the handler's requests through the model's limit", async () => {
		const requests: Array<() => void> = []
		const fakeAi = {
			id: "limiter-spec",
			async *createMessage(
				_system = "",
				_messages: unknown[] = [],
				_metadata?: ApiHandlerCreateMessageMetadata,
			): ApiStream {
				await new Promise<void>((resolve) => requests.push(resolve))
				yield { type: "text", text: "done" }
			},
			getModel: () => ({ id: "limiter-spec-model", info: { contextWindow: 1000, supportsPromptCache: false } }),
			countTokens: async () => 0,
			completePrompt: async () => "done",
		}
		const profile = { apiProvider: "fake-ai", fakeAi, maxConcurrentRequests: 1 } as ProviderSettings
		const first = drain(buildApiHandler(profile).createMessage("", []))
		const second = drain(buildApiHandler(profile).createMessage("", []))
		await tick()
		expect(requests).toHaveLength(1)

		requests[0]()
		await first
		await vi.waitFor(() => expect(requests).toHaveLength(2))
		requests[1]()
		await second
	})
})
