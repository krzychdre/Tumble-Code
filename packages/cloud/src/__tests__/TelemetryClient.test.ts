/* eslint-disable @typescript-eslint/no-explicit-any */

// npx vitest run src/__tests__/TelemetryClient.test.ts

import { type TelemetryPropertiesProvider, TelemetryEventName } from "@tumble-code/types"

import { CloudTelemetryClient as TelemetryClient } from "../TelemetryClient.js"

const mockFetch = vi.fn()
global.fetch = mockFetch as any

describe("TelemetryClient", () => {
	const getPrivateProperty = <T>(instance: any, propertyName: string): T => {
		return instance[propertyName]
	}

	let mockAuthService: any
	let mockSettingsService: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a mock AuthService instead of using the singleton
		mockAuthService = {
			getSessionToken: vi.fn().mockReturnValue("mock-token"),
			getState: vi.fn().mockReturnValue("active-session"),
			isAuthenticated: vi.fn().mockReturnValue(true),
			hasActiveSession: vi.fn().mockReturnValue(true),
		}

		// Create a mock SettingsService
		mockSettingsService = {
			getSettings: vi.fn().mockReturnValue({
				cloudSettings: {
					recordTaskMessages: true,
				},
			}),
			getUserSettings: vi.fn().mockReturnValue({
				features: {},
				settings: {
					taskSyncEnabled: true,
				},
				version: 1,
			}),
			isTaskSyncEnabled: vi.fn().mockReturnValue(true),
		}

		mockFetch.mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({}),
		})

		vi.spyOn(console, "info").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("isEventCapturable", () => {
		it("should return true for events not in exclude list", () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_CREATED)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.LLM_COMPLETION)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.MODE_SWITCH)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.TOOL_USED)).toBe(true)
		})

		it("should return false for events in exclude list", () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_CONVERSATION_MESSAGE)).toBe(false)
		})

		it("should return true for TASK_MESSAGE events when isTaskSyncEnabled returns true", () => {
			mockSettingsService.isTaskSyncEnabled.mockReturnValue(true)

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_MESSAGE)).toBe(true)
			expect(mockSettingsService.isTaskSyncEnabled).toHaveBeenCalled()
		})

		it("should return false for TASK_MESSAGE events when isTaskSyncEnabled returns false", () => {
			mockSettingsService.isTaskSyncEnabled.mockReturnValue(false)

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_MESSAGE)).toBe(false)
			expect(mockSettingsService.isTaskSyncEnabled).toHaveBeenCalled()
		})
	})

	describe("getEventProperties", () => {
		it("should merge provider properties with event properties", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
				}),
			}

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: {
					customProp: "value",
					mode: "override", // This should override the provider's mode.
				},
			})

			expect(result).toEqual({
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "override", // Event property takes precedence.
				customProp: "value",
			})

			expect(mockProvider.getTelemetryProperties).toHaveBeenCalledTimes(1)
		})

		// A subagent's events name its own task, which is not the current
		// one; the provider needs the id to report that task's parent.
		it("asks the provider for the properties of the event's task", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)
			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({}),
			}
			client.setProvider(mockProvider)
			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			await getEventProperties({ event: TelemetryEventName.LLM_COMPLETION, properties: { taskId: "sub-1" } })
			await getEventProperties({ event: TelemetryEventName.TASK_CREATED, properties: {} })

			expect(mockProvider.getTelemetryProperties).toHaveBeenNthCalledWith(1, "sub-1")
			expect(mockProvider.getTelemetryProperties).toHaveBeenNthCalledWith(2, undefined)
		})

		it("should handle errors from provider gracefully", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockRejectedValue(new Error("Provider error")),
			}

			const consoleErrorSpy = vi.spyOn(console, "error")

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: { customProp: "value" },
			})

			expect(result).toEqual({ customProp: "value" })
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error getting telemetry properties: Provider error"),
			)
		})

		it("should return event properties when no provider is set", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: { customProp: "value" },
			})

			expect(result).toEqual({ customProp: "value" })
		})
	})

	describe("capture", () => {
		it("should not capture events that are not capturable", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_CONVERSATION_MESSAGE, // In exclude list.
				properties: { test: "value" },
			})

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not capture TASK_MESSAGE events when recordTaskMessages is false", async () => {
			mockSettingsService.getSettings.mockReturnValue({
				cloudSettings: {
					recordTaskMessages: false,
				},
			})

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: {
					taskId: "test-task-id",
					message: {
						ts: 1,
						type: "say",
						say: "text",
						text: "test message",
					},
				},
			})

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not capture TASK_MESSAGE events when isTaskSyncEnabled returns false", async () => {
			mockSettingsService.isTaskSyncEnabled.mockReturnValue(false)

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: {
					taskId: "test-task-id",
					message: {
						ts: 1,
						type: "say",
						say: "text",
						text: "test message",
					},
				},
			})

			expect(mockFetch).not.toHaveBeenCalled()
			expect(mockSettingsService.isTaskSyncEnabled).toHaveBeenCalled()
		})

		it("should not send request when schema validation fails", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockFetch).not.toHaveBeenCalled()
			expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Invalid telemetry event"))
		})

		it("should send request when event is capturable and validation passes", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const providerProperties = {
				appName: "roo-code",
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "code",
			}

			const eventProperties = {
				taskId: "test-task-id",
			}

			const mockValidatedData = {
				type: TelemetryEventName.TASK_CREATED,
				properties: {
					...providerProperties,
					taskId: "test-task-id",
				},
			}

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue(providerProperties),
			}

			client.setProvider(mockProvider)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: eventProperties,
			})

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.tumblecode.dev/api/events",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify(mockValidatedData),
				}),
			)
		})

		it("should attempt to capture TASK_MESSAGE events when isTaskSyncEnabled returns true", async () => {
			mockSettingsService.isTaskSyncEnabled.mockReturnValue(true)

			const eventProperties = {
				appName: "roo-code",
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "code",
				taskId: "test-task-id",
				message: {
					ts: 1,
					type: "say",
					say: "text",
					text: "test message",
				},
			}

			const mockValidatedData = {
				type: TelemetryEventName.TASK_MESSAGE,
				properties: eventProperties,
			}

			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: eventProperties,
			})

			expect(mockSettingsService.isTaskSyncEnabled).toHaveBeenCalled()
			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.tumblecode.dev/api/events",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify(mockValidatedData),
				}),
			)
		})

		it("should handle fetch errors gracefully", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			mockFetch.mockRejectedValue(new Error("Network error"))

			await expect(
				client.capture({
					event: TelemetryEventName.TASK_CREATED,
					properties: { test: "value" },
				}),
			).resolves.not.toThrow()
		})

		it("should pass an AbortSignal timeout on the fetch call", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const providerProperties = {
				appName: "roo-code",
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "code",
			}

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue(providerProperties),
			}

			client.setProvider(mockProvider)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { taskId: "test-task-id" },
			})

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.tumblecode.dev/api/events",
				expect.objectContaining({
					signal: expect.any(AbortSignal),
				}),
			)
		})

		it("should handle fetch timeout gracefully (AbortError treated as failure)", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const abortError = new DOMException("The operation was aborted", "AbortError")
			mockFetch.mockRejectedValue(abortError)

			// A timeout must behave like any failed fetch — the error is caught
			// in capture(), logged, and the promise resolves without throwing.
			await expect(
				client.capture({
					event: TelemetryEventName.TASK_CREATED,
					properties: { test: "value" },
				}),
			).resolves.not.toThrow()
		})
	})

	describe("event properties and exceptions", () => {
		const providerProperties = {
			appName: "tumble-code",
			appVersion: "1.0.0",
			vscodeVersion: "1.60.0",
			platform: "linux",
			editorName: "vscode",
			language: "en",
			mode: "code",
		}

		const sentBody = () => JSON.parse(mockFetch.mock.calls[0]![1].body)

		const makeClient = () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)
			client.setProvider({ getTelemetryProperties: vi.fn().mockResolvedValue(providerProperties) })
			return client
		}

		it("keeps the event's own properties, such as the tool name", async () => {
			await makeClient().capture({
				event: TelemetryEventName.TOOL_USED,
				properties: { taskId: "t1", tool: "read_file" },
			})

			expect(sentBody()).toEqual({
				type: TelemetryEventName.TOOL_USED,
				properties: { ...providerProperties, taskId: "t1", tool: "read_file" },
			})
		})

		it("sends an exception with its name, message, own fields and extra properties", async () => {
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

			const error = new ProviderError("rate limited", "zai", 429, { nested: true })
			await makeClient().captureException(error, { taskId: "t1" })

			const body = sentBody()
			expect(body.type).toBe(TelemetryEventName.EXCEPTION)
			expect(body.properties).toMatchObject({
				...providerProperties,
				taskId: "t1",
				provider: "zai",
				errorCode: 429,
				errorName: "ProviderError",
				errorMessage: "rate limited",
			})
			expect(body.properties.stack).toContain("ProviderError")
			// Only primitive own fields are copied; objects stay behind.
			expect(body.properties).not.toHaveProperty("details")
		})

		it("shortens a long exception message and stack", async () => {
			const error = new Error("x".repeat(5_000))
			error.stack = "s".repeat(10_000)

			await makeClient().captureException(error)

			const { errorMessage, stack } = sentBody().properties
			expect(errorMessage).toHaveLength(2_001)
			expect(stack).toHaveLength(4_001)
		})

		it("sends no exception while signed out", async () => {
			mockAuthService.isAuthenticated.mockReturnValue(false)

			await makeClient().captureException(new Error("boom"))

			expect(mockFetch).not.toHaveBeenCalled()
		})
	})

	describe("telemetry state methods", () => {
		it("should return true for isTelemetryEnabled unless an off switch is set", () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)
			expect(client.isTelemetryEnabled()).toBe(true)
		})

		it.each(["TUMBLE_CODE_DISABLE_TELEMETRY", "ROO_CODE_DISABLE_TELEMETRY"])(
			"turns telemetry off when %s=1 (the second is the former name)",
			(name) => {
				vi.stubEnv(name, "1")
				try {
					const client = new TelemetryClient(mockAuthService, mockSettingsService)
					expect(client.isTelemetryEnabled()).toBe(false)
				} finally {
					vi.unstubAllEnvs()
				}
			},
		)

		it("should have an empty implementation for shutdown", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)
			await client.shutdown()
		})
	})

	describe("backfillMessages", () => {
		it("should not send request when not authenticated", async () => {
			mockAuthService.isAuthenticated.mockReturnValue(false)
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not send request when no session token available", async () => {
			mockAuthService.getSessionToken.mockReturnValue(null)
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).not.toHaveBeenCalled()
			expect(console.error).toHaveBeenCalledWith(
				"[TelemetryClient#backfillMessages] Unauthorized: No session token available.",
			)
		})

		it("should send FormData request with correct structure when authenticated", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const providerProperties = {
				appName: "roo-code",
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "code",
			}

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue(providerProperties),
			}

			client.setProvider(mockProvider)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message 1",
				},
				{
					ts: 2,
					type: "ask" as const,
					ask: "followup" as const,
					text: "test question",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.tumblecode.dev/api/events/backfill",
				expect.objectContaining({
					method: "POST",
					headers: {
						Authorization: "Bearer mock-token",
					},
					body: expect.any(FormData),
				}),
			)

			// Verify FormData contents
			const call = mockFetch.mock.calls[0]
			const formData = call?.[1]?.body as FormData

			expect(formData.get("taskId")).toBe("test-task-id")

			// Parse and compare properties as objects since JSON.stringify order can vary
			const propertiesJson = formData.get("properties") as string
			const parsedProperties = JSON.parse(propertiesJson)
			expect(parsedProperties).toEqual({
				taskId: "test-task-id",
				...providerProperties,
			})
			// The messages are stored as a File object under the "file" key
			const fileField = formData.get("file") as File
			expect(fileField).toBeInstanceOf(File)
			expect(fileField.name).toBe("task.json")
			expect(fileField.type).toBe("application/json")

			// Read the file content to verify the messages
			const fileContent = await fileField.text()
			expect(fileContent).toBe(JSON.stringify(messages))
		})

		it("should append the workspacePath field when the provider exposes one", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({}),
				getTelemetryWorkspacePath: vi.fn().mockReturnValue("/home/me/Projekty/Roo-Code-worktree-x"),
			}
			client.setProvider(mockProvider)

			await client.backfillMessages([{ ts: 1, type: "say", say: "text", text: "hi" }], "task-ws")

			const formData = mockFetch.mock.calls[0]?.[1]?.body as FormData
			expect(formData.get("workspacePath")).toBe("/home/me/Projekty/Roo-Code-worktree-x")
		})

		it("should omit workspacePath when the provider has none", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({}),
				getTelemetryWorkspacePath: vi.fn().mockReturnValue(undefined),
			}
			client.setProvider(mockProvider)

			await client.backfillMessages([{ ts: 1, type: "say", say: "text", text: "hi" }], "task-no-ws")

			const formData = mockFetch.mock.calls[0]?.[1]?.body as FormData
			expect(formData.has("workspacePath")).toBe(false)
		})

		it("should handle provider errors gracefully", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockRejectedValue(new Error("Provider error")),
			}

			client.setProvider(mockProvider)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.tumblecode.dev/api/events/backfill",
				expect.objectContaining({
					method: "POST",
					headers: {
						Authorization: "Bearer mock-token",
					},
					body: expect.any(FormData),
				}),
			)

			// Verify FormData contents - should still work with just taskId
			const call = mockFetch.mock.calls[0]
			const formData = call?.[1]?.body as FormData

			expect(formData.get("taskId")).toBe("test-task-id")
			expect(formData.get("properties")).toBe(
				JSON.stringify({
					taskId: "test-task-id",
				}),
			)

			// The messages are stored as a File object under the "file" key
			const fileField = formData.get("file") as File
			expect(fileField).toBeInstanceOf(File)
			expect(fileField.name).toBe("task.json")
			expect(fileField.type).toBe("application/json")

			// Read the file content to verify the messages
			const fileContent = await fileField.text()
			expect(fileContent).toBe(JSON.stringify(messages))
		})

		it("should work without provider set", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.tumblecode.dev/api/events/backfill",
				expect.objectContaining({
					method: "POST",
					headers: {
						Authorization: "Bearer mock-token",
					},
					body: expect.any(FormData),
				}),
			)

			// Verify FormData contents - should work with just taskId
			const call = mockFetch.mock.calls[0]
			const formData = call?.[1]?.body as FormData

			expect(formData.get("taskId")).toBe("test-task-id")
			expect(formData.get("properties")).toBe(
				JSON.stringify({
					taskId: "test-task-id",
				}),
			)

			// The messages are stored as a File object under the "file" key
			const fileField = formData.get("file") as File
			expect(fileField).toBeInstanceOf(File)
			expect(fileField.name).toBe("task.json")
			expect(fileField.type).toBe("application/json")

			// Read the file content to verify the messages
			const fileContent = await fileField.text()
			expect(fileContent).toBe(JSON.stringify(messages))
		})

		it("should handle fetch errors gracefully", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			mockFetch.mockRejectedValue(new Error("Network error"))

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await expect(client.backfillMessages(messages, "test-task-id")).resolves.not.toThrow()

			expect(console.error).toHaveBeenCalledWith(
				expect.stringContaining(
					"[TelemetryClient#backfillMessages] Error uploading messages: Error: Network error",
				),
			)
		})

		it("should handle HTTP error responses", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				statusText: "Not Found",
			})

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(console.error).toHaveBeenCalledWith(
				"[TelemetryClient#backfillMessages] POST events/backfill -> 404 Not Found",
			)
		})

		it("should pass an AbortSignal timeout on the backfill fetch call", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.tumblecode.dev/api/events/backfill",
				expect.objectContaining({
					signal: expect.any(AbortSignal),
				}),
			)
		})

		it("should handle empty messages array", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.backfillMessages([], "test-task-id")

			expect(mockFetch).toHaveBeenCalledWith(
				"https://app.tumblecode.dev/api/events/backfill",
				expect.objectContaining({
					method: "POST",
					headers: {
						Authorization: "Bearer mock-token",
					},
					body: expect.any(FormData),
				}),
			)

			// Verify FormData contents
			const call = mockFetch.mock.calls[0]
			const formData = call?.[1]?.body as FormData

			// The messages are stored as a File object under the "file" key
			const fileField = formData.get("file") as File
			expect(fileField).toBeInstanceOf(File)
			expect(fileField.name).toBe("task.json")
			expect(fileField.type).toBe("application/json")

			// Read the file content to verify the empty messages array
			const fileContent = await fileField.text()
			expect(fileContent).toBe("[]")
		})
	})
})
