// Characterization of the LM Studio model fetcher against the REAL @lmstudio/sdk
// client: only the LM Studio server is faked (fake-lmstudio-server.ts, HTTP plus the
// SDK's WebSocket protocol). lmstudio.test.ts replaces LMStudioClient, so nothing else notices
// when an SDK upgrade changes what goes over the socket or how answers are read.
// Written before DEP-6 (SDK 1.x to 2.x).

import nock from "nock"

vi.mock("../modelCache", () => ({
	flushModels: vi.fn(async () => {}),
}))

import { forceFullModelDetailsLoad, getLMStudioModels, hasLoadedFullDetails } from "../lmstudio"
import { flushModels } from "../modelCache"
import { startFakeLmStudioServer, type FakeLmStudioServer, type Responder } from "./fake-lmstudio-server"

// A model as a current LM Studio server describes it (the SDK drops fields it does not know).
const downloadedLlama = {
	type: "llm",
	modelKey: "llama-3.1-8b",
	format: "gguf",
	displayName: "Llama 3.1 8B",
	publisher: "meta",
	path: "meta/llama-3.1-8b/Llama-3.1-8B-Q4_K_M.gguf",
	sizeBytes: 4_900_000_000,
	indexedModelIdentifier: "meta/llama-3.1-8b/Llama-3.1-8B-Q4_K_M.gguf",
	deviceIdentifier: null,
	architecture: "llama",
	vision: false,
	trainedForToolUse: true,
	maxContextLength: 131072,
}
const downloadedQwen = {
	...downloadedLlama,
	modelKey: "qwen2.5-vl-7b",
	displayName: "Qwen2.5 VL 7B",
	publisher: "qwen",
	path: "qwen/qwen2.5-vl-7b",
	indexedModelIdentifier: "qwen/qwen2.5-vl-7b",
	architecture: "qwen2vl",
	vision: true,
	maxContextLength: 32768,
}
const loadedLlama = {
	...downloadedLlama,
	identifier: "llama-3.1-8b",
	instanceReference: "instance-1",
	ttlMs: null,
	lastUsedTime: null,
	contextLength: 8192,
}

let server: FakeLmStudioServer
let baseUrl: string
/** Strips the fields a server from before 2026 does not send. */
let oldServerShape: boolean

function asServerSends(info: Record<string, unknown>) {
	if (!oldServerShape) return info
	const { publisher, indexedModelIdentifier, deviceIdentifier, ttlMs, lastUsedTime, ...rest } = info
	return rest
}

/** The auth packet carries a random client identity; keep its shape, hide the random part. */
function masked(message: Record<string, any>) {
	if (message.authVersion === undefined) return message
	return {
		...message,
		clientIdentifier: String(message.clientIdentifier).replace(/[A-Za-z0-9+/]{16,}$/, "<random>"),
		clientPasskey: String(message.clientPasskey).replace(/^[A-Za-z0-9+/]{16,}$/, "<random>"),
	}
}

const answer: Responder = (message, reply) => {
	if (message.type === "rpcCall") {
		const results: Record<string, unknown> = {
			listDownloadedModels: [asServerSends(downloadedLlama), asServerSends(downloadedQwen)],
			listLoaded: [asServerSends(loadedLlama)],
			getModelInfo: asServerSends(loadedLlama),
		}
		reply({ type: "rpcResult", callId: message.callId, result: results[message.endpoint] })
		return
	}
	if (message.type === "channelCreate" && message.endpoint === "getOrLoad") {
		// A model that is not loaded yet: LM Studio loads it (JIT) and reports progress.
		const send = (packet: unknown) => reply({ type: "channelSend", channelId: message.channelId, message: packet })
		send({ type: "startLoading", identifier: "qwen2.5-vl-7b", info: asServerSends(downloadedQwen) })
		send({ type: "loadProgress", progress: 0.5 })
		send({
			type: "loadSuccess",
			info: asServerSends({
				...downloadedQwen,
				identifier: "qwen2.5-vl-7b",
				instanceReference: "instance-2",
				ttlMs: null,
				lastUsedTime: null,
				contextLength: 4096,
			}),
		})
	}
}

beforeAll(() => {
	nock.enableNetConnect(/127\.0\.0\.1/)
})

afterAll(() => {
	nock.disableNetConnect()
})

beforeEach(async () => {
	oldServerShape = false
	vi.spyOn(console, "warn").mockImplementation(() => {})
	vi.spyOn(console, "error").mockImplementation(() => {})
	vi.spyOn(console, "info").mockImplementation(() => {})
	server = await startFakeLmStudioServer({ respond: answer })
	baseUrl = server.baseUrl
})

afterEach(async () => {
	await server.stop()
	vi.restoreAllMocks()
})

/** What the SDK sent, with the random client identity masked. */
function recorded() {
	return server.recorded.map(({ path, message }) => ({ path, message: masked(message) }))
}

describe("LM Studio fetcher wire characterization (real @lmstudio/sdk, fake server)", () => {
	it("lists downloaded and loaded models over the SDK's sockets", async () => {
		const models = await getLMStudioModels(baseUrl)

		expect(server.httpRequests).toEqual(["GET /v1/models"])
		expect(recorded()).toEqual([
			{
				path: "/system",
				message: { authVersion: 1, clientIdentifier: "<random>", clientPasskey: "<random>" },
			},
			{ path: "/system", message: { type: "rpcCall", endpoint: "listDownloadedModels", callId: 0 } },
			{
				path: "/llm",
				message: { authVersion: 1, clientIdentifier: "<random>", clientPasskey: "<random>" },
			},
			{ path: "/llm", message: { type: "rpcCall", endpoint: "listLoaded", callId: 0 } },
			{
				path: "/llm",
				message: {
					type: "rpcCall",
					endpoint: "getModelInfo",
					callId: 1,
					parameter: {
						specifier: { type: "instanceReference", instanceReference: "instance-1" },
						throwIfNotFound: false,
					},
				},
			},
		])
		// The loaded model replaces its downloaded entry and reports the loaded context length.
		expect(Object.keys(models).sort()).toEqual(["llama-3.1-8b", "qwen/qwen2.5-vl-7b"])
		expect(models["llama-3.1-8b"]).toMatchObject({
			description: "Llama 3.1 8B - meta/llama-3.1-8b/Llama-3.1-8B-Q4_K_M.gguf",
			contextWindow: 8192,
			maxTokens: 8192,
			supportsImages: false,
			supportsPromptCache: true,
		})
		expect(models["qwen/qwen2.5-vl-7b"]).toMatchObject({
			description: "Qwen2.5 VL 7B - qwen/qwen2.5-vl-7b",
			contextWindow: 32768,
			maxTokens: 32768,
			supportsImages: true,
		})
		expect(hasLoadedFullDetails("llama-3.1-8b")).toBe(true)
		expect(hasLoadedFullDetails("qwen/qwen2.5-vl-7b")).toBe(false)
	})

	it("loads a model that is not loaded yet (preload before a task) and refreshes the list", async () => {
		await forceFullModelDetailsLoad(baseUrl, "qwen/qwen2.5-vl-7b")

		expect(server.httpRequests).toEqual(["GET /v1/models"])
		expect(recorded().map((entry) => entry.message.type ?? "auth")).toEqual(["auth", "channelCreate"])
		expect(recorded()[1]).toEqual({
			path: "/llm",
			message: {
				type: "channelCreate",
				endpoint: "getOrLoad",
				channelId: 0,
				creationParameter: {
					identifier: "qwen/qwen2.5-vl-7b",
					loadConfigStack: {
						layers: [
							{
								layerName: "apiOverride",
								config: {
									fields: [
										{
											key: "load.gpuSplitConfig",
											value: {
												strategy: "evenly",
												disabledGpus: [],
												priority: [],
												customRatio: [],
											},
										},
									],
								},
							},
						],
					},
				},
			},
		})
		expect(flushModels).toHaveBeenCalledWith({ provider: "lmstudio", baseUrl }, true)
		expect(hasLoadedFullDetails("qwen/qwen2.5-vl-7b")).toBe(true)
	})

	it("returns no models and opens no socket when the server is down", async () => {
		const closed = baseUrl
		await server.stop()
		server = await startFakeLmStudioServer({ respond: answer })

		expect(await getLMStudioModels(closed)).toEqual({})
		expect(recorded()).toEqual([])
	})

	it("reads model lists from an LM Studio server that predates the 2026 protocol fields", async () => {
		oldServerShape = true

		const models = await getLMStudioModels(baseUrl)

		expect(Object.keys(models).sort()).toEqual(["llama-3.1-8b", "qwen/qwen2.5-vl-7b"])
	})
})
