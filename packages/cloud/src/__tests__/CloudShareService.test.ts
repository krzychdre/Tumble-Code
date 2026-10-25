/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Mock } from "vitest"
import * as vscode from "vscode"

import type { SettingsService, AuthService } from "@tumble-code/types"

import { CloudAPI } from "../CloudAPI.js"
import { CloudShareService } from "../CloudShareService.js"
import { AuthenticationError, CloudAPIError, NetworkError, TaskNotFoundError } from "../errors.js"

const mockFetch = vi.fn()
global.fetch = mockFetch as any

vi.mock("vscode", () => ({
	env: { clipboard: { writeText: vi.fn() } },
}))

vi.mock("../config", () => ({
	getTumbleCodeApiUrl: () => "http://localhost:8080",
}))

vi.mock("../utils", () => ({
	getUserAgent: () => "Tumble-Code 1.0.0",
}))

const SHARED = { success: true, shareUrl: "http://localhost:8080/share/abc123" }

const httpError = (status: number, body: string) => ({
	ok: false,
	status,
	statusText: body,
	json: async () => {
		throw new SyntaxError("not JSON")
	},
	text: async () => body,
})

describe("CloudShareService", () => {
	let authService: { getSessionToken: Mock }
	let settingsService: { getSettings: Mock }
	let log: Mock<(...args: unknown[]) => void>
	let shareService: CloudShareService

	beforeEach(() => {
		vi.clearAllMocks()
		log = vi.fn()
		authService = { getSessionToken: vi.fn().mockReturnValue("session-token") }
		settingsService = { getSettings: vi.fn() }
		mockFetch.mockResolvedValue({ ok: true, json: async () => SHARED })
		shareService = new CloudShareService(
			new CloudAPI(authService as unknown as AuthService, log),
			settingsService as unknown as SettingsService,
			log,
		)
	})

	describe("shareTask", () => {
		it.each([
			["organization", undefined],
			["organization", "organization"],
			["public", "public"],
		] as const)("posts %s visibility (asked for %s) and copies the link", async (sent, asked) => {
			const result = await shareService.shareTask("task-123", asked)

			expect(result).toEqual(SHARED)
			expect(mockFetch).toHaveBeenCalledWith("http://localhost:8080/api/extension/share", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer session-token",
					"User-Agent": "Tumble-Code 1.0.0",
				},
				body: JSON.stringify({ taskId: "task-123", visibility: sent }),
				signal: expect.any(AbortSignal),
			})
			expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(SHARED.shareUrl)
		})

		it("returns a refusal from the server without copying anything", async () => {
			mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: false, error: "Task not found" }) })

			expect(await shareService.shareTask("task-123")).toEqual({ success: false, error: "Task not found" })
			expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
		})

		it("still returns the link when the clipboard fails or is missing", async () => {
			vi.mocked(vscode.env.clipboard.writeText).mockRejectedValueOnce(new Error("denied"))
			expect(await shareService.shareTask("task-123")).toEqual(SHARED)
			expect(log).toHaveBeenCalledWith("[ShareService] Clipboard write failed (non-fatal):", expect.any(Error))

			const writeText = vscode.env.clipboard.writeText
			;(vscode.env.clipboard as any).writeText = undefined
			try {
				expect(await shareService.shareTask("task-123")).toEqual(SHARED)
			} finally {
				;(vscode.env.clipboard as any).writeText = writeText
			}
			expect(log).toHaveBeenCalledWith(expect.stringContaining("clipboard unavailable"))
		})

		it("requires a session token", async () => {
			authService.getSessionToken.mockReturnValue(null)

			await expect(shareService.shareTask("task-123")).rejects.toBeInstanceOf(AuthenticationError)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it.each([
			["401", () => mockFetch.mockResolvedValue(httpError(401, "Unauthorized")), AuthenticationError, undefined],
			[
				"404",
				() => mockFetch.mockResolvedValue(httpError(404, "Not Found")),
				TaskNotFoundError,
				"Task not found",
			],
			["500", () => mockFetch.mockResolvedValue(httpError(500, "Boom")), CloudAPIError, "HTTP 500: Boom"],
			["fetch failed", () => mockFetch.mockRejectedValue(new TypeError("fetch failed")), NetworkError, undefined],
			[
				"a timeout",
				() => mockFetch.mockRejectedValue(new DOMException("aborted", "AbortError")),
				CloudAPIError,
				"Request to /api/extension/share timed out",
			],
			[
				"an unexpected error",
				() => mockFetch.mockRejectedValue(new Error("Network error")),
				CloudAPIError,
				"Unexpected error while calling /api/extension/share: Network error",
			],
			[
				"an invalid answer",
				() => mockFetch.mockResolvedValue({ ok: true, json: async () => ({ shareUrl: 1 }) }),
				CloudAPIError,
				"Unexpected error while calling /api/extension/share",
			],
		])("maps %s to its error and logs it", async (_name, arrange, errorClass, message) => {
			arrange()

			const error = await shareService.shareTask("task-123").catch((e) => e)

			expect(error).toBeInstanceOf(errorClass)
			if (message) {
				expect(error.message).toContain(message)
			}
			expect(log).toHaveBeenCalledWith("[ShareService] Error sharing task:", error)
		})

		it("keeps the status and body of an HTTP error", async () => {
			mockFetch.mockResolvedValue(httpError(503, "Unavailable"))

			const error = await shareService.shareTask("task-123").catch((e) => e)

			expect(error).toMatchObject({ statusCode: 503, responseBody: "Unavailable" })
		})
	})

	it.each([
		[undefined, false, false],
		[{}, false, false],
		[{ enableTaskSharing: false, allowPublicTaskSharing: true }, false, false],
		[{ enableTaskSharing: true }, true, true],
		[{ enableTaskSharing: true, allowPublicTaskSharing: false }, true, false],
	])("cloud settings %j allow sharing %s, publicly %s", async (cloudSettings, task, publicly) => {
		settingsService.getSettings.mockReturnValue(cloudSettings && { cloudSettings })

		expect(await shareService.canShareTask()).toBe(task)
		expect(await shareService.canSharePublicly()).toBe(publicly)
	})

	it("allows no sharing when the settings cannot be read", async () => {
		settingsService.getSettings.mockImplementation(() => {
			throw new Error("Settings error")
		})

		expect(await shareService.canShareTask()).toBe(false)
		expect(await shareService.canSharePublicly()).toBe(false)
		expect(log).toHaveBeenCalledTimes(2)
	})
})
