/* eslint-disable @typescript-eslint/no-explicit-any */

// npx vitest run src/__tests__/outboundRedaction.spec.ts

import { gunzipSync } from "zlib"

import { TaskSocketEvents, TelemetryEventName, TumbleCodeEventName } from "@tumble-code/types"

import { BridgeOrchestrator, type BridgeEventSource } from "../bridge/BridgeOrchestrator.js"
import { LlmExchangeClient } from "../LlmExchangeClient.js"
import { RetryQueue } from "../retry-queue/index.js"
import { CloudTelemetryClient } from "../TelemetryClient.js"

vi.mock("../config.js", () => ({ getTumbleCodeApiUrl: () => "https://cloud.example" }))

const mockFetch = vi.fn()
global.fetch = mockFetch as any

/** The active profile's key (a known key shape) and another profile's key (no known shape). */
const ACTIVE_KEY = "sk-TEST-LEAK-123"
const OTHER_PROFILE_KEY = "free-form-key-7f3a9c"
const secretValues = () => [ACTIVE_KEY, OTHER_PROFILE_KEY]

/** What the SDKs throw for a key with a line break, plus the other profile's key; MARKER must survive. */
const MARKER = "INTACT-MARKER-42"
const ERROR_TEXT = `${MARKER} Headers.append: "Bearer ${ACTIVE_KEY}\nX" is an invalid header value. Fallback ${OTHER_PROFILE_KEY}`

const SHA = "a".repeat(64)

const authService: any = {
	getSessionToken: () => "session-token",
	isAuthenticated: () => true,
}

function telemetryClient(retryQueue?: RetryQueue) {
	const client = new CloudTelemetryClient(
		authService,
		{ isTaskSyncEnabled: () => true } as any,
		secretValues,
		retryQueue,
	)
	const provider = {
		getTelemetryProperties: async () => ({
			appName: "tumble-code",
			appVersion: "1.0.0",
			vscodeVersion: "1.60.0",
			platform: "linux",
			editorName: "vscode",
			language: "en",
			mode: "code",
		}),
	}
	client.setProvider(provider as any)
	// The client keeps a WeakRef to the provider; keep it alive for the test.
	;(client as any).heldProvider = provider
	return client
}

const sentText = () => {
	const body = mockFetch.mock.calls.at(-1)![1].body
	return typeof body === "string" ? body : gunzipSync(body).toString("utf8")
}

async function backfillText() {
	await telemetryClient().backfillMessages([{ ts: 1, type: "say", say: "error", text: ERROR_TEXT }], "t1")
	const form = mockFetch.mock.calls.at(-1)![1].body as FormData
	return `${form.get("properties")} ${await (form.get("file") as File).text()}`
}

async function retryQueueText() {
	mockFetch.mockRejectedValue(new TypeError("fetch failed"))
	const storage = { get: () => undefined, update: vi.fn(async () => {}) }
	const queue = new RetryQueue(storage, { networkCheckInterval: 3_600_000 }, () => {})
	await telemetryClient(queue)
		.captureException(new Error(ERROR_TEXT))
		.catch(() => {})
	queue.dispose()
	return JSON.stringify(storage.update.mock.calls.at(-1))
}

async function bridgeText() {
	const socket: any = {
		emitted: [] as unknown[],
		io: { on() {} },
		on() {},
		emit: (...args: unknown[]) => socket.emitted.push(args),
	}
	const listeners = new Map<string, (...args: unknown[]) => void>()
	const bus = { on: (event: string, listener: any) => listeners.set(event, listener), off() {} }
	await new BridgeOrchestrator({
		getBridgeConfig: async () => ({ userId: "u1", socketBridgeUrl: "http://bridge", token: "t" }),
		provider: {} as any,
		events: bus as BridgeEventSource,
		workspacePath: "/work",
		snapshot: async () => null,
		secretValues,
		ioFactory: (() => socket) as any,
	}).start()
	listeners.get(TumbleCodeEventName.Message)!({
		taskId: "t1",
		action: "created",
		message: { ts: 1, type: "say", say: "error", text: ERROR_TEXT },
	})
	const [event] = socket.emitted.filter(([name]: [string]) => name === TaskSocketEvents.EVENT)
	return JSON.stringify(event)
}

describe("nothing sent to the cloud carries a stored secret value", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(console, "error").mockImplementation(() => {})
		mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK", json: async () => ({}) })
	})

	it.each<[string, () => Promise<string>]>([
		[
			"an exception event",
			async () => {
				await telemetryClient().captureException(new Error(ERROR_TEXT))
				return sentText()
			},
		],
		[
			"a synced task message",
			async () => {
				await telemetryClient().capture({
					event: TelemetryEventName.TASK_MESSAGE,
					properties: { taskId: "t1", message: { ts: 1, type: "say", say: "error", text: ERROR_TEXT } },
				})
				return sentText()
			},
		],
		[
			"an error report",
			async () => {
				await telemetryClient().sendErrorReport({
					id: "4b0d2f6e-6a7e-4d55-9d36-3c1f0e7a9b10",
					occurredAt: 1,
					category: "api_error",
					summary: "request failed",
					errorMessage: ERROR_TEXT,
				})
				return sentText()
			},
		],
		["a backfill upload", backfillText],
		["the retry queue's persisted body", retryQueueText],
		[
			"an LLM exchange upload",
			async () => {
				await new LlmExchangeClient(authService, secretValues).sendExchange({
					id: "4b0d2f6e-6a7e-4d55-9d36-3c1f0e7a9b10",
					taskId: "t1",
					sequence: 0,
					occurredAt: 1,
					retryAttempt: 0,
					modelId: "glm-5.3",
					request: {
						system: { sha256: SHA, text: "You are Tumble." },
						tools: { sha256: SHA, text: "[]" },
						messages: { keep: 0, append: [{ role: "user", content: "hi" }] },
						messageCount: 1,
						params: {},
					},
					response: {},
					status: "error",
					error: { message: ERROR_TEXT, body: ERROR_TEXT },
				})
				return sentText()
			},
		],
		["a task event over the bridge", bridgeText],
	])("%s", async (_path, send) => {
		const text = await send()

		expect(text).toContain(MARKER)
		expect(text).toContain("is an invalid header value")
		expect(text).not.toContain(ACTIVE_KEY)
		expect(text).not.toContain(OTHER_PROFILE_KEY)
	})
})
