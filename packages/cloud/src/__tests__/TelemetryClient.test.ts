/* eslint-disable @typescript-eslint/no-explicit-any */

// npx vitest run src/__tests__/TelemetryClient.test.ts

import { type ClineMessage, type TelemetryPropertiesProvider, TelemetryEventName } from "@tumble-code/types"

import { CloudTelemetryClient as TelemetryClient } from "../TelemetryClient.js"

const mockFetch = vi.fn()
global.fetch = mockFetch as any

const PROVIDER_PROPERTIES = {
	appName: "tumble-code",
	appVersion: "1.0.0",
	vscodeVersion: "1.60.0",
	platform: "linux",
	editorName: "vscode",
	language: "en",
	mode: "code",
}

const MESSAGES: ClineMessage[] = [
	{ ts: 1, type: "say", say: "text", text: "test message" },
	{ ts: 2, type: "ask", ask: "followup", text: "test question" },
]

describe("CloudTelemetryClient", () => {
	let authService: any
	let settingsService: any
	// Held here: the client keeps only a WeakRef to it.
	let provider: TelemetryPropertiesProvider

	const makeClient = (providerOverride: Partial<TelemetryPropertiesProvider> | null = {}) => {
		const client = new TelemetryClient(authService, settingsService)
		if (providerOverride) {
			provider = {
				getTelemetryProperties: vi.fn().mockResolvedValue(PROVIDER_PROPERTIES),
				...providerOverride,
			}
			client.setProvider(provider)
		}
		return client
	}

	const sentCall = () => mockFetch.mock.calls.at(-1)!
	const sentBody = () => JSON.parse(sentCall()[1].body)
	const sentForm = () => sentCall()[1].body as FormData

	beforeEach(() => {
		vi.clearAllMocks()
		authService = {
			getSessionToken: vi.fn().mockReturnValue("mock-token"),
			isAuthenticated: vi.fn().mockReturnValue(true),
		}
		settingsService = { isTaskSyncEnabled: vi.fn().mockReturnValue(true) }
		mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" })
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllEnvs()
	})

	describe("capture", () => {
		it("posts the validated event with the session token, a timeout and provider properties under event ones", async () => {
			await makeClient().capture({
				event: TelemetryEventName.TOOL_USED,
				properties: { taskId: "t1", tool: "read_file", mode: "architect" },
			})

			const [url, options] = sentCall()
			expect(url).toBe("https://app.tumblecode.dev/api/events")
			expect(options.method).toBe("POST")
			expect(options.headers).toEqual({ Authorization: "Bearer mock-token", "Content-Type": "application/json" })
			expect(options.signal).toBeInstanceOf(AbortSignal)
			expect(sentBody()).toEqual({
				type: TelemetryEventName.TOOL_USED,
				properties: { ...PROVIDER_PROPERTIES, taskId: "t1", tool: "read_file", mode: "architect" },
			})
		})

		// A subagent's events name its own task, which is not the current
		// one; the provider needs the id to report that task's parent.
		it("asks the provider for the properties of the event's task", async () => {
			const client = makeClient()

			await client.capture({ event: TelemetryEventName.TASK_CREATED, properties: { taskId: "sub-1" } })
			await client.capture({ event: TelemetryEventName.TASK_CREATED, properties: {} })

			expect(provider.getTelemetryProperties).toHaveBeenNthCalledWith(1, "sub-1")
			expect(provider.getTelemetryProperties).toHaveBeenNthCalledWith(2, undefined)
		})

		it("sends a task message only while task sync is enabled", async () => {
			const capture = () =>
				makeClient().capture({
					event: TelemetryEventName.TASK_MESSAGE,
					properties: { taskId: "t1", message: MESSAGES[0] },
				})

			settingsService.isTaskSyncEnabled.mockReturnValue(false)
			await capture()
			expect(mockFetch).not.toHaveBeenCalled()

			settingsService.isTaskSyncEnabled.mockReturnValue(true)
			await capture()
			expect(sentBody()).toEqual({
				type: TelemetryEventName.TASK_MESSAGE,
				properties: { ...PROVIDER_PROPERTIES, taskId: "t1", message: MESSAGES[0] },
			})
		})

		it("never sends the excluded conversation-message event", async () => {
			await makeClient().capture({
				event: TelemetryEventName.TASK_CONVERSATION_MESSAGE,
				properties: { taskId: "t1" },
			})

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("drops an event that fails the wire schema", async () => {
			await makeClient(null).capture({ event: TelemetryEventName.TASK_CREATED, properties: { test: "value" } })

			expect(mockFetch).not.toHaveBeenCalled()
			expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Invalid telemetry event"))
		})

		it.each([
			["signed out", () => authService.isAuthenticated.mockReturnValue(false)],
			["without a session token", () => authService.getSessionToken.mockReturnValue(null)],
			["with telemetry switched off", () => vi.stubEnv("TUMBLE_CODE_DISABLE_TELEMETRY", "1")],
		])("sends nothing %s", async (_name, arrange) => {
			arrange()

			await makeClient().capture({ event: TelemetryEventName.TASK_CREATED, properties: { taskId: "t1" } })

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("swallows a failed request", async () => {
			mockFetch.mockRejectedValue(new Error("Network error"))

			await expect(
				makeClient().capture({ event: TelemetryEventName.TASK_CREATED, properties: { taskId: "t1" } }),
			).resolves.toBeUndefined()
			expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Error sending telemetry event"))
		})
	})

	/**
	 * The payload is posted as `tumbleCodeTelemetryEventSchema.safeParse(...).data`,
	 * and Zod drops keys the schema does not declare. That is how 16 393 `Tool
	 * Used` rows ended up with no `tool` on the live deployment. These pin the
	 * properties the usage metrics depend on to the wire.
	 */
	describe("usage properties on the wire", () => {
		it("keeps completionKind and usageReported, and lets a side call name its own model", async () => {
			const client = makeClient({
				getTelemetryProperties: vi.fn().mockResolvedValue({ ...PROVIDER_PROPERTIES, modelId: "task-model" }),
			})

			await client.capture({
				event: TelemetryEventName.LLM_COMPLETION,
				properties: {
					taskId: "t1",
					inputTokens: 100,
					outputTokens: 10,
					completionKind: "enhance",
					usageReported: true,
					modelId: "enhancement-model",
				},
			})

			expect(sentBody().properties).toMatchObject({
				completionKind: "enhance",
				usageReported: true,
				modelId: "enhancement-model",
			})
		})

		it("still sends a completion that names no kind, as every stored row predates it", async () => {
			await makeClient().capture({
				event: TelemetryEventName.LLM_COMPLETION,
				properties: { taskId: "t1", inputTokens: 100, outputTokens: 10 },
			})

			expect(sentBody().properties.completionKind).toBeUndefined()
		})

		it("sends embedding usage as its own event, with its token figures intact", async () => {
			await makeClient().capture({
				event: TelemetryEventName.EMBEDDING_USAGE,
				properties: { promptTokens: 128_000, totalTokens: 128_000, source: "index-scan" },
			})

			expect(sentBody()).toMatchObject({
				type: "Embedding Usage",
				properties: { promptTokens: 128_000, source: "index-scan" },
			})
		})
	})

	describe("captureException", () => {
		it("sends the name, message, stack, primitive own fields and extra properties", async () => {
			class ProviderError extends Error {
				constructor(
					message: string,
					public readonly provider: string,
					public readonly errorCode: number,
					public readonly details: object,
				) {
					super(message)
					this.name = "ProviderError"
				}
			}

			await makeClient().captureException(new ProviderError("rate limited", "zai", 429, { nested: true }), {
				taskId: "t1",
			})

			const body = sentBody()
			expect(body.type).toBe(TelemetryEventName.EXCEPTION)
			expect(body.properties).toMatchObject({
				...PROVIDER_PROPERTIES,
				taskId: "t1",
				provider: "zai",
				errorCode: 429,
				errorName: "ProviderError",
				errorMessage: "rate limited",
			})
			expect(body.properties.stack).toContain("ProviderError")
			expect(body.properties).not.toHaveProperty("details")
		})

		it("shortens a long message and stack, and omits a missing stack", async () => {
			const long = new Error("x".repeat(5_000))
			long.stack = "s".repeat(10_000)
			await makeClient().captureException(long)
			expect(sentBody().properties.errorMessage).toHaveLength(2_001)
			expect(sentBody().properties.stack).toHaveLength(4_001)

			const noStack = new Error("short")
			noStack.stack = undefined
			await makeClient().captureException(noStack)
			expect(sentBody().properties).not.toHaveProperty("stack")
		})
	})

	it.each(["TUMBLE_CODE_DISABLE_TELEMETRY", "ROO_CODE_DISABLE_TELEMETRY"])(
		"reports telemetry off when %s=1 (the second is the former name), on otherwise",
		(name) => {
			const client = makeClient(null)
			expect(client.isTelemetryEnabled()).toBe(true)
			vi.stubEnv(name, "1")
			expect(client.isTelemetryEnabled()).toBe(false)
		},
	)

	describe("backfillMessages", () => {
		it("posts the messages as task.json with the merged properties, workspace path and a timeout", async () => {
			await makeClient({ getTelemetryWorkspacePath: () => "/home/me/project" }).backfillMessages(MESSAGES, "t1")

			const [url, options] = sentCall()
			expect(url).toBe("https://app.tumblecode.dev/api/events/backfill")
			expect(options.method).toBe("POST")
			expect(options.headers).toEqual({ Authorization: "Bearer mock-token" })
			expect(options.signal).toBeInstanceOf(AbortSignal)

			const form = sentForm()
			expect(form.get("taskId")).toBe("t1")
			expect(JSON.parse(form.get("properties") as string)).toEqual({ ...PROVIDER_PROPERTIES, taskId: "t1" })
			expect(form.get("workspacePath")).toBe("/home/me/project")
			const file = form.get("file") as File
			expect(file.name).toBe("task.json")
			expect(file.type).toBe("application/json")
			expect(await file.text()).toBe(JSON.stringify(MESSAGES))
		})

		it("still sends the task id when the provider fails or is missing", async () => {
			const failing = makeClient({
				getTelemetryProperties: vi.fn().mockRejectedValue(new Error("Provider error")),
			})
			await failing.backfillMessages(MESSAGES, "t1")
			expect(JSON.parse(sentForm().get("properties") as string)).toEqual({ taskId: "t1" })
			expect(console.error).toHaveBeenCalledWith("Error getting telemetry properties: Provider error")

			await makeClient(null).backfillMessages(MESSAGES, "t2")
			expect(JSON.parse(sentForm().get("properties") as string)).toEqual({ taskId: "t2" })
		})

		it("omits workspacePath when the provider has none", async () => {
			await makeClient({ getTelemetryWorkspacePath: () => undefined }).backfillMessages(MESSAGES, "t1")

			expect(sentForm().has("workspacePath")).toBe(false)
		})

		it.each([
			["signed out", () => authService.isAuthenticated.mockReturnValue(false)],
			["without a session token", () => authService.getSessionToken.mockReturnValue(null)],
			["with telemetry switched off", () => vi.stubEnv("ROO_CODE_DISABLE_TELEMETRY", "1")],
		])("sends nothing %s", async (_name, arrange) => {
			arrange()

			await makeClient().backfillMessages(MESSAGES, "t1")

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("logs a refused backfill and swallows a network error", async () => {
			const client = makeClient()

			mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" })
			await client.backfillMessages(MESSAGES, "t1")
			expect(console.error).toHaveBeenCalledWith(
				"[TelemetryClient#backfillMessages] POST events/backfill -> 404 Not Found",
			)

			mockFetch.mockRejectedValueOnce(new Error("Network error"))
			await expect(client.backfillMessages(MESSAGES, "t1")).resolves.toBeUndefined()
			expect(console.error).toHaveBeenCalledWith(
				"[TelemetryClient#backfillMessages] Error uploading messages: Error: Network error",
			)
		})
	})
})
