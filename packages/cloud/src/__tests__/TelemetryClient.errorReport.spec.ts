/* eslint-disable @typescript-eslint/no-explicit-any */

// npx vitest run src/__tests__/TelemetryClient.errorReport.spec.ts

import type { ErrorReport } from "@tumble-code/types"

import { CloudTelemetryClient as TelemetryClient } from "../TelemetryClient.js"

vi.mock("../config.js", () => ({ getTumbleCodeApiUrl: () => "https://cloud.example" }))

const mockFetch = vi.fn()
global.fetch = mockFetch as any

const REPORT: ErrorReport = {
	id: "4b0d2f6e-6a7e-4d55-9d36-3c1f0e7a9b10",
	occurredAt: 1_760_000_000_000,
	category: "invalid_tool_call",
	summary: "apply_diff called without 'path'",
	taskId: "task-1",
	modelId: "glm-5.3",
	toolName: "apply_diff",
	response: { toolCalls: [{ id: "call_1", name: "apply_diff", arguments: '{"diff":"x"}' }] },
}

describe("CloudTelemetryClient.sendErrorReport", () => {
	let authService: any
	let retryQueue: any
	let client: TelemetryClient
	const savedEnv = { ...process.env }

	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(console, "error").mockImplementation(() => {})
		delete process.env.TUMBLE_CODE_DISABLE_TELEMETRY
		delete process.env.ROO_CODE_DISABLE_TELEMETRY

		authService = {
			getSessionToken: vi.fn().mockReturnValue("session-token"),
			isAuthenticated: vi.fn().mockReturnValue(true),
		}
		retryQueue = { enqueue: vi.fn().mockResolvedValue(undefined) }
		mockFetch.mockResolvedValue({ ok: true, status: 202, statusText: "Accepted" })

		client = new TelemetryClient(authService, { isTaskSyncEnabled: () => true } as any, retryQueue)
	})

	afterEach(() => {
		process.env = { ...savedEnv }
		vi.restoreAllMocks()
	})

	it("posts the report as JSON to /api/error-reports with the session token", async () => {
		await client.sendErrorReport(REPORT)

		expect(mockFetch).toHaveBeenCalledTimes(1)
		const [url, options] = mockFetch.mock.calls[0]!
		expect(url).toBe("https://cloud.example/api/error-reports")
		expect(options.method).toBe("POST")
		expect(options.headers).toEqual({ Authorization: "Bearer session-token", "Content-Type": "application/json" })
		expect(JSON.parse(options.body)).toEqual(REPORT)
	})

	it("does nothing when the user is not signed in", async () => {
		authService.isAuthenticated.mockReturnValue(false)

		await client.sendErrorReport(REPORT)

		expect(mockFetch).not.toHaveBeenCalled()
		expect(retryQueue.enqueue).not.toHaveBeenCalled()
		expect(authService.getSessionToken).not.toHaveBeenCalled()
	})

	it.each(["TUMBLE_CODE_DISABLE_TELEMETRY", "ROO_CODE_DISABLE_TELEMETRY"])("does nothing when %s=1", async (name) => {
		process.env[name] = "1"

		await client.sendErrorReport(REPORT)

		expect(mockFetch).not.toHaveBeenCalled()
	})

	it("drops a report that does not match the wire schema", async () => {
		await client.sendErrorReport({ ...REPORT, category: "nonsense" } as any)

		expect(mockFetch).not.toHaveBeenCalled()
	})

	it.each([500, 503, 429])("queues the request for retry on HTTP %i", async (status) => {
		mockFetch.mockResolvedValue({ ok: false, status, statusText: "fail" })

		await client.sendErrorReport(REPORT)

		expect(retryQueue.enqueue).toHaveBeenCalledTimes(1)
		const [url, options, type] = retryQueue.enqueue.mock.calls[0]
		expect(url).toBe("https://cloud.example/api/error-reports")
		expect(JSON.parse(options.body)).toEqual(REPORT)
		expect(type).toBe("telemetry")
	})

	it("does not queue a client error such as 413", async () => {
		mockFetch.mockResolvedValue({ ok: false, status: 413, statusText: "Too Large" })

		await client.sendErrorReport(REPORT)

		expect(retryQueue.enqueue).not.toHaveBeenCalled()
	})

	it("queues on a network failure and never throws", async () => {
		mockFetch.mockRejectedValue(new TypeError("fetch failed"))

		await expect(client.sendErrorReport(REPORT)).resolves.toBeUndefined()

		expect(retryQueue.enqueue).toHaveBeenCalledTimes(1)
	})
})
