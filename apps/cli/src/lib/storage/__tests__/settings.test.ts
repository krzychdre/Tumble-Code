import fs from "fs"
import path from "path"
import os from "os"

import { getConfigDir } from "@/lib/storage/index.js"

import { loadSettings, saveSettings, getSettingsPath } from "@/lib/storage/settings.js"

vi.mock("@/lib/storage/index.js", () => ({
	getConfigDir: vi.fn(),
}))

const mockGetConfigDir = getConfigDir as unknown as ReturnType<typeof vi.fn>

describe("cli settings persistence", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-settings-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("loads empty settings when the file does not exist", async () => {
		await expect(loadSettings()).resolves.toEqual({})
	})

	it("persists provider/model/base-url and reuses them on the next load", async () => {
		await saveSettings({ provider: "ollama", model: "llama3", baseUrl: "http://localhost:11434" })

		const settings = await loadSettings()
		expect(settings.provider).toBe("ollama")
		expect(settings.model).toBe("llama3")
		expect(settings.baseUrl).toBe("http://localhost:11434")
	})

	it("merges with existing settings rather than overwriting", async () => {
		await saveSettings({ model: "claude-opus-4" })
		await saveSettings({ provider: "openrouter" })

		const settings = await loadSettings()
		expect(settings.model).toBe("claude-opus-4")
		expect(settings.provider).toBe("openrouter")
	})

	it("removes provider/model/baseUrl when explicitly set to undefined", async () => {
		await saveSettings({ provider: "openrouter", model: "m1", baseUrl: "u1" })
		await saveSettings({ provider: undefined, model: undefined, baseUrl: undefined })

		const settings = await loadSettings()
		expect(settings.provider).toBeUndefined()
		expect(settings.model).toBeUndefined()
		expect(settings.baseUrl).toBeUndefined()

		const raw = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"))
		expect(raw.provider).toBeUndefined()
		expect(raw.model).toBeUndefined()
		expect(raw.baseUrl).toBeUndefined()
	})

	it("never persists api keys", async () => {
		await saveSettings({ provider: "anthropic" })
		const raw = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"))
		expect(raw.apiKey).toBeUndefined()
	})

	it("does not rewrite the file when nothing changes (mtime/content unchanged)", async () => {
		await saveSettings({ provider: "openrouter", model: "m1", baseUrl: "https://openrouter.example" })
		const pathBefore = getSettingsPath()
		const mtimeBefore = fs.statSync(pathBefore).mtimeMs
		const contentBefore = fs.readFileSync(pathBefore, "utf-8")

		// Re-saving identical values must be a no-op at the storage layer too:
		// the caller skips the write, but saveSettings never rewrites identical
		// merged content.
		await saveSettings({ provider: "openrouter", model: "m1", baseUrl: "https://openrouter.example" })

		expect(fs.statSync(pathBefore).mtimeMs).toBe(mtimeBefore)
		expect(fs.readFileSync(pathBefore, "utf-8")).toBe(contentBefore)
	})
})
