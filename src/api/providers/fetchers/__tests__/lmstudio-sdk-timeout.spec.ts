// The LM Studio fetcher against the REAL @lmstudio/sdk and a fake LM Studio server that
// never answers, or answers something the SDK cannot validate. The SDK has no timeout of
// its own and never settles such a call, so without a bound the model list stays empty
// forever and the preload before a task keeps the task from starting.

import nock from "nock"

vi.mock("../modelCache", () => ({
	flushModels: vi.fn(async () => {}),
}))

import * as fetcher from "../lmstudio"
import { forceFullModelDetailsLoad, getLMStudioModels } from "../lmstudio"
import { startFakeLmStudioServer, type FakeLmStudioServer, type Responder } from "./fake-lmstudio-server"

const downloaded = {
	type: "llm",
	modelKey: "qwen2.5-7b",
	format: "gguf",
	displayName: "Qwen2.5 7B",
	publisher: "qwen",
	path: "qwen/qwen2.5-7b",
	sizeBytes: 4_700_000_000,
	indexedModelIdentifier: "qwen/qwen2.5-7b",
	deviceIdentifier: null,
	architecture: "qwen2",
	vision: false,
	trainedForToolUse: true,
	maxContextLength: 32768,
}
const loaded = {
	...downloaded,
	identifier: "qwen2.5-7b",
	instanceReference: "instance-1",
	ttlMs: null,
	lastUsedTime: null,
	contextLength: 8192,
}

/** A healthy server: lists, describes and loads at once. */
const healthy: Responder = (message, send) => {
	if (message.type === "rpcCall") {
		const results: Record<string, unknown> = {
			listDownloadedModels: [downloaded],
			listLoaded: [loaded],
			getModelInfo: loaded,
		}
		send({ type: "rpcResult", callId: message.callId, result: results[message.endpoint] })
	}
	if (message.type === "channelCreate") {
		send({ type: "channelSend", channelId: message.channelId, message: { type: "alreadyLoaded", info: loaded } })
	}
}

/** Accepts the connection, then never answers a call. */
const silent: Responder = () => {}

/** Answers with a model that lacks `path`: the SDK rejects the answer and keeps waiting. */
const unreadable: Responder = (message, send) => {
	const { path, ...withoutPath } = downloaded
	if (message.type === "rpcCall") {
		send({ type: "rpcResult", callId: message.callId, result: [withoutPath] })
	}
	if (message.type === "channelCreate") {
		send({
			type: "channelSend",
			channelId: message.channelId,
			message: { type: "alreadyLoaded", info: withoutPath },
		})
	}
}

const REQUEST_MS = 200
const LOAD_IDLE_MS = 300
/** Well past every bound above: a call still pending then would have hung. */
const HANG_MS = 3000

let server: FakeLmStudioServer | undefined
let consoleError: ReturnType<typeof vi.spyOn>

async function serve(respond: Responder, answerHttp = true) {
	server = await startFakeLmStudioServer({ respond, answerHttp })
	return server
}

async function settleWithin<T>(promise: Promise<T>): Promise<{ settled: true; value: T } | { settled: false }> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const hung = new Promise<{ settled: false }>((resolve) => {
		timer = setTimeout(() => resolve({ settled: false }), HANG_MS)
	})
	try {
		return await Promise.race([promise.then((value) => ({ settled: true as const, value })), hung])
	} finally {
		clearTimeout(timer)
	}
}

const originalTimeouts = { ...fetcher.LM_STUDIO_TIMEOUTS }

beforeAll(() => {
	nock.enableNetConnect(/127\.0\.0\.1/)
})

afterAll(() => {
	nock.disableNetConnect()
})

beforeEach(() => {
	Object.assign(fetcher.LM_STUDIO_TIMEOUTS ?? {}, { requestMs: REQUEST_MS, loadIdleMs: LOAD_IDLE_MS })
	vi.spyOn(console, "warn").mockImplementation(() => {})
	vi.spyOn(console, "info").mockImplementation(() => {})
	consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(async () => {
	await server?.stop()
	server = undefined
	Object.assign(fetcher.LM_STUDIO_TIMEOUTS ?? {}, originalTimeouts)
	vi.restoreAllMocks()
})

function loggedErrors(): string {
	return consoleError.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).join("\n")
}

describe("LM Studio fetcher: bounded SDK calls", () => {
	describe("model list", () => {
		it.each([
			["never answers", silent],
			["answers something the SDK cannot validate", unreadable],
		])("returns an empty list with a clear log when the server %s", async (_name, respond) => {
			const { baseUrl } = await serve(respond)

			const outcome = await settleWithin(getLMStudioModels(baseUrl))

			expect(outcome).toEqual({ settled: true, value: {} })
			expect(loggedErrors()).toContain(`LM Studio at ${baseUrl} did not answer`)
		})

		it("returns an empty list when the HTTP probe never answers", async () => {
			const { baseUrl } = await serve(healthy, false)

			const outcome = await settleWithin(getLMStudioModels(baseUrl))

			expect(outcome).toEqual({ settled: true, value: {} })
			expect(server!.recorded).toEqual([])
		})

		it("still lists a healthy server's models and closes its sockets afterwards", async () => {
			const { baseUrl } = await serve(healthy)

			const models = await getLMStudioModels(baseUrl)

			expect(Object.keys(models)).toEqual(["qwen2.5-7b"])
			await vi.waitFor(() => expect(server!.openSockets()).toBe(0))
		})
	})

	describe("preload before a task", () => {
		it.each([
			["never answers", silent],
			["answers something the SDK cannot validate", unreadable],
		])("rejects with a clear error when the server %s", async (_name, respond) => {
			const { baseUrl } = await serve(respond)

			const outcome = await settleWithin(
				forceFullModelDetailsLoad(baseUrl, "qwen/qwen2.5-7b").then(
					() => "resolved",
					(error: Error) => error.message,
				),
			)

			expect(outcome.settled).toBe(true)
			expect(outcome.settled && outcome.value).toMatch(
				new RegExp(`^LM Studio at ${baseUrl} did not answer while loading qwen/qwen2\\.5-7b`),
			)
			// The load is cancelled on the server too.
			expect(server!.recorded.map((entry) => entry.message)).toContainEqual({
				type: "channelSend",
				channelId: expect.any(Number),
				message: { type: "cancel" },
			})
			await vi.waitFor(() => expect(server!.openSockets()).toBe(0))
		})

		it("waits for a long load as long as LM Studio reports progress", async () => {
			// Progress every 100 ms for 1 s: far longer than the idle bound, never idle that long.
			const { baseUrl } = await serve((message, send) => {
				if (message.type !== "channelCreate") return
				const reply = (packet: unknown) =>
					send({ type: "channelSend", channelId: message.channelId, message: packet })
				reply({ type: "startLoading", identifier: "qwen2.5-7b", info: downloaded })
				let step = 0
				const timer = setInterval(() => {
					step++
					if (step < 10) {
						reply({ type: "loadProgress", progress: step / 10 })
						return
					}
					clearInterval(timer)
					reply({ type: "loadSuccess", info: loaded })
				}, 100)
			})

			const outcome = await settleWithin(
				forceFullModelDetailsLoad(baseUrl, "qwen/qwen2.5-7b").then(() => "resolved"),
			)

			expect(outcome).toEqual({ settled: true, value: "resolved" })
			await vi.waitFor(() => expect(server!.openSockets()).toBe(0))
		})

		it("keeps swallowing a server that is down (the task starts, as before)", async () => {
			const { baseUrl } = await serve(healthy)
			await server!.stop()
			server = undefined

			await expect(forceFullModelDetailsLoad(baseUrl, "qwen/qwen2.5-7b")).resolves.toBeUndefined()
		})
	})
})
