// npx vitest run api/providers/__tests__/qwen-code-token-refresh.spec.ts

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

const mockCreate = vi.hoisted(() => vi.fn())
vi.mock("openai", async () => {
	const { openAiModuleMock } = await import("./provider-test-helpers")
	return openAiModuleMock(mockCreate, { apiKey: "", baseURL: "" })
})

import { getApiErrorStatus, isAutoRetryableApiError } from "../../apiErrors"
import { QwenCodeHandler } from "../qwen-code"

describe("QwenCodeHandler token refresh", () => {
	let dir: string
	let credsPath: string
	const fetchMock = vi.fn()

	const expiredCredentials = {
		access_token: "old-access",
		refresh_token: "old-refresh",
		token_type: "Bearer",
		expiry_date: Date.now() - 1000,
		resource_url: "portal.qwen.ai",
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.stubGlobal("fetch", fetchMock)
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-creds-"))
		credsPath = path.join(dir, "oauth_creds.json")
		await fs.writeFile(credsPath, JSON.stringify(expiredCredentials), { mode: 0o600 })
		await fs.chmod(credsPath, 0o600)
		mockCreate.mockResolvedValue({ choices: [{ message: { content: "ok" } }] })
	})

	afterEach(async () => {
		vi.unstubAllGlobals()
		await fs.rm(dir, { recursive: true, force: true })
	})

	const handler = () => new QwenCodeHandler({ apiModelId: "qwen3-coder-plus", qwenCodeOauthPath: credsPath })

	// The token endpoint answers 400 (invalid_grant) for an expired or revoked refresh token: an
	// auth failure like 401, which the retry loop must not retry blindly.
	it.each([
		[401, "Unauthorized", 401],
		[400, "Bad Request", 401],
		[403, "Forbidden", 403],
		[503, "Service Unavailable", 503],
	])("a failed refresh (%s) rejects with status %s for the retry loop", async (status, statusText, expected) => {
		fetchMock.mockResolvedValue(new Response("refresh failed", { status, statusText }))

		const error = await handler()
			.completePrompt("hi")
			.catch((e: unknown) => e)

		expect(error).toBeInstanceOf(Error)
		expect((error as Error).message).toContain(`Token refresh failed: ${status}`)
		expect(getApiErrorStatus(error)).toBe(expected)
		expect(isAutoRetryableApiError(error)).toBe(expected === 503)
		expect(mockCreate).not.toHaveBeenCalled()
	})

	it("writes refreshed credentials atomically and keeps the 0600 file mode", async () => {
		fetchMock.mockResolvedValue(
			Response.json({
				access_token: "new-access",
				refresh_token: "new-refresh",
				token_type: "Bearer",
				expires_in: 3600,
			}),
		)

		const inodeBefore = (await fs.stat(credsPath)).ino

		await expect(handler().completePrompt("hi")).resolves.toBe("ok")

		// A new inode means the file was replaced by a rename, not rewritten in place.
		expect((await fs.stat(credsPath)).ino).not.toBe(inodeBefore)

		const saved = JSON.parse(await fs.readFile(credsPath, "utf8"))
		expect(saved).toMatchObject({
			access_token: "new-access",
			refresh_token: "new-refresh",
			resource_url: "portal.qwen.ai",
		})
		expect(saved.expiry_date).toBeGreaterThan(Date.now())
		// Windows has no POSIX permission bits: stat reports 0o666 for any writable file.
		if (process.platform !== "win32") {
			expect((await fs.stat(credsPath)).mode & 0o777).toBe(0o600)
		}
		// No temp file or lock left behind next to the credentials.
		expect(await fs.readdir(dir)).toEqual(["oauth_creds.json"])
	})
})
