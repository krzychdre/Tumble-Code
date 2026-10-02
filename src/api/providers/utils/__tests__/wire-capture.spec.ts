// npx vitest run api/providers/utils/__tests__/wire-capture.spec.ts

import OpenAI from "openai"

import { runWithWireCapture, wireCaptureFetch, type WireRequest } from "../wire-capture"

describe("wireCaptureFetch", () => {
	const realFetch = globalThis.fetch
	const fetchMock = vi.fn(async (_input: unknown, _init?: unknown) => new Response("{}", { status: 200 }))

	beforeEach(() => {
		fetchMock.mockClear()
		globalThis.fetch = fetchMock as unknown as typeof fetch
	})

	afterEach(() => {
		globalThis.fetch = realFetch
	})

	it("is a plain pass-through outside a capture context", async () => {
		const init = { method: "POST", body: '{"a":1}' }

		await wireCaptureFetch("https://api.example/v1/chat/completions", init)

		expect(fetchMock).toHaveBeenCalledWith("https://api.example/v1/chat/completions", init)
	})

	it("hands the exact body to the sink of the current context, across awaits", async () => {
		const seen: WireRequest[] = []

		await runWithWireCapture(
			(request) => seen.push(request),
			async () => {
				await Promise.resolve()
				await new Promise((resolve) => setTimeout(resolve, 1))
				await wireCaptureFetch(new URL("https://api.example/v1/messages"), { method: "post", body: '{"b":2}' })
			},
		)

		expect(seen).toEqual([{ url: "https://api.example/v1/messages", method: "POST", body: '{"b":2}' }])
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("does not leak a context into a call started outside it", async () => {
		const seen: WireRequest[] = []
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => (release = resolve))

		const inside = runWithWireCapture(
			(request) => seen.push(request),
			async () => {
				await gate
				await wireCaptureFetch("https://a.example/x", { method: "POST", body: "inside" })
			},
		)
		const outside = (async () => {
			await gate
			await wireCaptureFetch("https://b.example/y", { method: "POST", body: "outside" })
		})()
		release()
		await Promise.all([inside, outside])

		expect(seen.map((request) => request.body)).toEqual(["inside"])
	})

	it("covers a provider stream whose first next() runs inside the context (the task loop's use)", async () => {
		const seen: WireRequest[] = []
		async function* createMessage() {
			await Promise.resolve()
			await wireCaptureFetch("https://api.example/v1/chat/completions", { method: "POST", body: "first" })
			yield "chunk 1"
			// After the first chunk the loop reads outside the context: not captured.
			await wireCaptureFetch("https://api.example/v1/other", { method: "POST", body: "later" })
			yield "chunk 2"
		}
		const iterator = createMessage()[Symbol.asyncIterator]()

		const first = await runWithWireCapture(
			(request) => seen.push(request),
			() => iterator.next(),
		)
		const second = await iterator.next()

		expect([first.value, second.value]).toEqual(["chunk 1", "chunk 2"])
		expect(seen.map((request) => request.body)).toEqual(["first"])
	})

	it("a sink that throws never breaks the request", async () => {
		await runWithWireCapture(
			() => {
				throw new Error("recorder bug")
			},
			() => wireCaptureFetch("https://api.example/x", { method: "POST", body: "{}" }),
		)

		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("sees the body the OpenAI SDK sends, byte for byte", async () => {
		fetchMock.mockImplementation(
			async () =>
				new Response(
					JSON.stringify({
						id: "c",
						object: "chat.completion",
						created: 0,
						model: "m",
						choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi" } }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		)
		const client = new OpenAI({ apiKey: "k", baseURL: "https://api.example/v1", fetch: wireCaptureFetch })
		const params = { model: "m", messages: [{ role: "user" as const, content: "zażółć" }], temperature: 0.2 }
		const seen: WireRequest[] = []

		await runWithWireCapture(
			(request) => seen.push(request),
			() => client.chat.completions.create(params),
		)

		expect(seen).toHaveLength(1)
		expect(seen[0]!.url).toBe("https://api.example/v1/chat/completions")
		expect(seen[0]!.body).toBe(JSON.stringify(params))
	})
})
