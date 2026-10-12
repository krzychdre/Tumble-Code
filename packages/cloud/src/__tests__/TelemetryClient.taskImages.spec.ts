/* eslint-disable @typescript-eslint/no-explicit-any */

// npx vitest run src/__tests__/TelemetryClient.taskImages.spec.ts

import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { type ClineMessage, type TelemetryPropertiesProvider, TelemetryEventName } from "@tumble-code/types"

import { CloudTelemetryClient as TelemetryClient } from "../TelemetryClient.js"

/**
 * Images a message points to by path are uploaded next to it (plan:
 * 2026-10-12 cloud web task images), only where the message itself is sent.
 */

const mockFetch = vi.fn()
global.fetch = mockFetch as any

const PROVIDER_PROPERTIES = {
	appName: "roo-code",
	appVersion: "1.0.0",
	vscodeVersion: "1.60.0",
	platform: "darwin",
	editorName: "vscode",
	language: "en",
	mode: "code",
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function imageCalls() {
	return mockFetch.mock.calls.filter(([url]) => String(url).includes("/images"))
}

function message(text: string, extra: Partial<ClineMessage> = {}): ClineMessage {
	return { ts: 1234, type: "say", say: "text", text, ...extra }
}

describe("TelemetryClient: task images", () => {
	let workspace: string
	let authService: any
	let settingsService: any
	let client: TelemetryClient
	// Held here: the client keeps only a WeakRef to it.
	let provider: TelemetryPropertiesProvider

	beforeEach(async () => {
		vi.clearAllMocks()
		mockFetch.mockReset()
		delete process.env.TUMBLE_CODE_DISABLE_TELEMETRY

		workspace = await mkdtemp(path.join(os.tmpdir(), "telemetry-images-"))
		await mkdir(path.join(workspace, "monitoring"))
		await writeFile(path.join(workspace, "monitoring", "chart.png"), PNG)

		authService = {
			getSessionToken: vi.fn().mockReturnValue("mock-token"),
			isAuthenticated: vi.fn().mockReturnValue(true),
		}
		settingsService = {
			isTaskSyncEnabled: vi.fn().mockReturnValue(true),
		}

		mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" })

		client = new TelemetryClient(authService, settingsService)
		provider = {
			getTelemetryProperties: vi.fn().mockResolvedValue(PROVIDER_PROPERTIES),
			getTelemetryWorkspacePath: vi.fn().mockReturnValue(workspace),
		}
		client.setProvider(provider)
	})

	afterEach(async () => {
		await rm(workspace, { recursive: true, force: true })
	})

	const capture = (msg: ClineMessage, taskId = "task/1") =>
		client.capture({ event: TelemetryEventName.TASK_MESSAGE, properties: { taskId, message: msg } })

	it("uploads a referenced workspace image after a finished message is sent", async () => {
		await capture(message("Chart:\n![Ryzyko](monitoring/chart.png)\n![web](https://x.dev/a.png)"))

		await vi.waitFor(() => expect(imageCalls()).toHaveLength(1))
		const [url, options] = imageCalls()[0]!
		expect(url).toBe("https://app.tumblecode.dev/api/tasks/task%2F1/images")
		expect(options.method).toBe("POST")
		expect(options.headers).toEqual({ Authorization: "Bearer mock-token" })
		expect(options.signal).toBeInstanceOf(AbortSignal)

		const form = options.body as FormData
		expect(form.get("messageTs")).toBe("1234")
		expect(form.get("path")).toBe("monitoring/chart.png")
		const file = form.get("file") as File
		expect(file.type).toBe("image/png")
		expect(file.name).toBe("chart.png")
		expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG)
	})

	it("sends the same file for the same message once, and again once it changes", async () => {
		await capture(message("![a](monitoring/chart.png)"))
		await vi.waitFor(() => expect(imageCalls()).toHaveLength(1))

		await capture(message("![a](monitoring/chart.png)"))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(imageCalls()).toHaveLength(1)

		await writeFile(path.join(workspace, "monitoring", "chart.png"), Buffer.concat([PNG, PNG]))
		await utimes(path.join(workspace, "monitoring", "chart.png"), new Date(), new Date(Date.now() + 5_000))
		await capture(message("![a](monitoring/chart.png)"))
		await vi.waitFor(() => expect(imageCalls()).toHaveLength(2))
	})

	it("sends nothing for a partial message, a missing file or an unsupported type", async () => {
		await writeFile(path.join(workspace, "drawing.svg"), "<svg/>")
		await capture(message("![a](monitoring/chart.png)", { partial: true }))
		await capture(message("![b](missing.png) ![c](drawing.svg)"))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(imageCalls()).toHaveLength(0)
	})

	it("sends nothing when task sync is off or the event did not go out", async () => {
		settingsService.isTaskSyncEnabled.mockReturnValue(false)
		await capture(message("![a](monitoring/chart.png)"))

		settingsService.isTaskSyncEnabled.mockReturnValue(true)
		mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Boom" })
		await capture(message("![a](monitoring/chart.png)"))

		authService.isAuthenticated.mockReturnValue(false)
		await capture(message("![a](monitoring/chart.png)"))

		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(imageCalls()).toHaveLength(0)
	})

	it("uploads images of every backfilled message after the backfill succeeds", async () => {
		await writeFile(path.join(workspace, "b.jpg"), PNG)
		await client.backfillMessages(
			[
				message("![a](monitoring/chart.png)", { ts: 1 }),
				message(`![b](${path.join(workspace, "b.jpg")})`, { ts: 2 }),
			],
			"task-b",
		)

		await vi.waitFor(() => expect(imageCalls()).toHaveLength(2))
		const forms = imageCalls().map(([, options]) => options.body as FormData)
		expect(forms.map((form) => form.get("messageTs"))).toEqual(["1", "2"])
		expect((forms[1]!.get("file") as File).type).toBe("image/jpeg")
	})

	it("uploads nothing when the backfill was refused", async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 403, statusText: "Forbidden" })
		await client.backfillMessages([message("![a](monitoring/chart.png)")], "task-c")
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(imageCalls()).toHaveLength(0)
	})

	it("logs a refused upload once and does not resend it, but tries again after a server error", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
		mockFetch.mockImplementation(async (url: string) =>
			url.includes("/images")
				? { ok: false, status: 415, statusText: "Unsupported Media Type" }
				: { ok: true, status: 200, statusText: "OK" },
		)

		await capture(message("![a](monitoring/chart.png)"))
		await vi.waitFor(() => expect(imageCalls()).toHaveLength(1))
		await capture(message("![a](monitoring/chart.png)"))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(imageCalls()).toHaveLength(1)
		expect(consoleError.mock.calls.filter(([line]) => String(line).includes("415"))).toHaveLength(1)

		mockFetch.mockImplementation(async (url: string) =>
			url.includes("/images")
				? { ok: false, status: 503, statusText: "Unavailable" }
				: { ok: true, status: 200, statusText: "OK" },
		)
		await capture(message("![a](monitoring/chart.png)", { ts: 99 }))
		await vi.waitFor(() => expect(imageCalls()).toHaveLength(2))
		await capture(message("![a](monitoring/chart.png)", { ts: 99 }))
		await vi.waitFor(() => expect(imageCalls()).toHaveLength(3))
		consoleError.mockRestore()
	})

	it("never lets a network error escape into the event path", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
		mockFetch.mockImplementation(async (url: string) => {
			if (url.includes("/images")) {
				throw new TypeError("fetch failed")
			}
			return { ok: true, status: 200, statusText: "OK" }
		})

		await expect(capture(message("![a](monitoring/chart.png)"))).resolves.toBeUndefined()
		await vi.waitFor(() => expect(imageCalls()).toHaveLength(1))
		consoleError.mockRestore()
	})
})
