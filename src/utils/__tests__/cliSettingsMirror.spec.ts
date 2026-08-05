import fs from "fs"
import os from "os"
import path from "path"

import type { ProviderSettings } from "@roo-code/types"

import {
	buildCliSettingsFromApiConfiguration,
	writeCliSettingsMirror,
	setCliSettingsPathOverride,
} from "../cliSettingsMirror"

describe("buildCliSettingsFromApiConfiguration", () => {
	it("maps openrouter provider/model/baseUrl (fields the CLI reads)", () => {
		const config: ProviderSettings = {
			apiProvider: "openrouter",
			openRouterModelId: "openai/gpt-4o",
			openRouterBaseUrl: "https://openrouter.example/api/v1",
			openRouterApiKey: "sk-secret",
		}

		const result = buildCliSettingsFromApiConfiguration(config)

		expect(result).toEqual({
			provider: "openrouter",
			model: "openai/gpt-4o",
			baseUrl: "https://openrouter.example/api/v1",
		})
		// Never mirror keys.
		expect(JSON.stringify(result)).not.toContain("ApiKey")
		expect(JSON.stringify(result)).not.toContain("sk-secret")
	})

	it("maps openai model/baseUrl via openAiModelId/openAiBaseUrl", () => {
		const config: ProviderSettings = {
			apiProvider: "openai",
			openAiModelId: "gpt-4o",
			openAiBaseUrl: "https://api.openai.example/v1",
		}

		expect(buildCliSettingsFromApiConfiguration(config)).toEqual({
			provider: "openai",
			model: "gpt-4o",
			baseUrl: "https://api.openai.example/v1",
		})
	})

	it("maps anthropic via apiModelId and anthropicBaseUrl", () => {
		const config: ProviderSettings = {
			apiProvider: "anthropic",
			apiModelId: "claude-opus-4.6",
			anthropicBaseUrl: "https://anthropic.example",
		}

		expect(buildCliSettingsFromApiConfiguration(config)).toEqual({
			provider: "anthropic",
			model: "claude-opus-4.6",
			baseUrl: "https://anthropic.example",
		})
	})

	it("maps openai-native model via apiModelId (its model field)", () => {
		const config: ProviderSettings = {
			apiProvider: "openai-native",
			apiModelId: "gpt-5",
		}

		expect(buildCliSettingsFromApiConfiguration(config)).toEqual({
			provider: "openai-native",
			model: "gpt-5",
		})
	})

	it("omits null/undefined values (CLI null-strip semantics)", () => {
		expect(buildCliSettingsFromApiConfiguration({ apiProvider: "openrouter" })).toEqual({
			provider: "openrouter",
		})
		expect(buildCliSettingsFromApiConfiguration({} as ProviderSettings)).toEqual({})
	})

	it("does not include unknown provider-specific keys", () => {
		const config: ProviderSettings = {
			apiProvider: "openrouter",
			openRouterSpecificProvider: "openai",
		}

		const result = buildCliSettingsFromApiConfiguration(config)
		expect(result.provider).toBe("openrouter")
		expect(result).not.toHaveProperty("openRouterSpecificProvider")
	})

	it("picks the model field of the ACTIVE provider — a stale openRouterModelId never wins for openai (bug 2b)", () => {
		// The editor kept a leftover openRouterModelId ("anthropic/claude-opus-4.6")
		// in globalState while apiProvider=openai with a real openAiModelId. The
		// mirror must mirror the openai model — never the stale openrouter one.
		const config: ProviderSettings = {
			apiProvider: "openai",
			openRouterModelId: "anthropic/claude-opus-4.6",
			openAiModelId: "DeepSeek-V4-Flash-0731",
			openAiBaseUrl: "http://localhost:1234/v1",
		}

		expect(buildCliSettingsFromApiConfiguration(config)).toEqual({
			provider: "openai",
			model: "DeepSeek-V4-Flash-0731",
			baseUrl: "http://localhost:1234/v1",
		})
	})

	it("falls back to no model when the active provider's own model field is unset (no cross-provider leak)", () => {
		// apiProvider=openai but only a stale openRouterModelId exists — the
		// stale model must NOT be mirrored at all.
		const config: ProviderSettings = {
			apiProvider: "openai",
			openRouterModelId: "anthropic/claude-opus-4.6",
		}

		expect(buildCliSettingsFromApiConfiguration(config)).toEqual({
			provider: "openai",
		})
	})
})

describe("writeCliSettingsMirror", () => {
	const tmpDir = path.join(os.tmpdir(), `cli-mirror-test-${process.pid}-${Date.now()}`)
	const settingsFile = path.join(tmpDir, "cli-settings.json")

	beforeEach(() => {
		setCliSettingsPathOverride(settingsFile)
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	afterEach(() => {
		setCliSettingsPathOverride(undefined)
	})

	afterAll(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("creates the file with the mapped settings when none exists", async () => {
		await writeCliSettingsMirror({
			apiProvider: "openrouter",
			openRouterModelId: "openai/gpt-4o",
			openRouterBaseUrl: "https://openrouter.example/api/v1",
		})

		expect(JSON.parse(fs.readFileSync(settingsFile, "utf-8"))).toEqual({
			provider: "openrouter",
			model: "openai/gpt-4o",
			baseUrl: "https://openrouter.example/api/v1",
		})
	})

	it("merges — preserves unrelated keys already present in the file", async () => {
		fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
		fs.writeFileSync(
			settingsFile,
			JSON.stringify({ provider: "openrouter", mode: "code", reasoningEffort: "high" }),
		)

		await writeCliSettingsMirror({ apiProvider: "openai", openAiModelId: "gpt-4o" })

		expect(JSON.parse(fs.readFileSync(settingsFile, "utf-8"))).toEqual({
			provider: "openai",
			model: "gpt-4o",
			mode: "code",
			reasoningEffort: "high",
		})
	})

	it("is a no-op under NODE_ENV=test without an explicit override", async () => {
		const originalNodeEnv = process.env.NODE_ENV
		process.env.NODE_ENV = "test"
		setCliSettingsPathOverride(undefined)
		try {
			await writeCliSettingsMirror({ apiProvider: "openrouter", openRouterModelId: "openai/gpt-4o" })
			// No file may exist in the sandbox — the write was skipped.
			expect(fs.existsSync(path.join(tmpDir, "cli-settings.json"))).toBe(false)
		} finally {
			if (originalNodeEnv !== undefined) {
				process.env.NODE_ENV = originalNodeEnv
			} else {
				delete process.env.NODE_ENV
			}
		}
	})

	it("never writes API keys to disk", async () => {
		await writeCliSettingsMirror({
			apiProvider: "openrouter",
			openRouterModelId: "openai/gpt-4o",
			openRouterApiKey: "sk-super-secret",
		})

		const raw = fs.readFileSync(settingsFile, "utf-8")
		expect(raw).not.toContain("sk-super-secret")
		expect(raw).not.toContain("ApiKey")
	})

	it("is best-effort — a broken homedir write never throws", async () => {
		vi.spyOn(path, "join").mockImplementationOnce(() => os.homedir())
		await expect(writeCliSettingsMirror({ apiProvider: "openrouter" })).resolves.toBeUndefined()
	})
})
