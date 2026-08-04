import fs from "fs"
import path from "path"
import os from "os"

import {
	readVsCodeConfig,
	getShimGlobalStorageDir,
	VSCODE_CONFIG_SECRETS_FILE,
	VSCODE_CONFIG_GLOBAL_STATE_FILE,
} from "@/lib/utils/vscode-config.js"

const V1_ENVELOPE = JSON.stringify({
	apiProvider: "openrouter",
	openRouterModelId: "anthropic/claude-opus-4.6",
	openRouterBaseUrl: "https://openrouter.example",
	openRouterApiKey: "sk-123",
})

describe("readVsCodeConfig", () => {
	let tmpStorage: string
	let originalHome: string | undefined

	beforeEach(() => {
		tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-"))
		originalHome = process.env.HOME
		process.env.HOME = tmpStorage
	})

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME
		else process.env.HOME = originalHome
		fs.rmSync(tmpStorage, { recursive: true, force: true })
	})

	it("returns undefined when no config exists", () => {
		expect(readVsCodeConfig()).toBeUndefined()
		expect(getShimGlobalStorageDir()).toBe(path.join(tmpStorage, ".vscode-mock", "global-storage"))
	})

	it("reads provider/model/baseUrl/key from legacy flat secrets + global state", () => {
		fs.mkdirSync(path.join(tmpStorage, ".vscode-mock", "global-storage"), { recursive: true })
		fs.writeFileSync(
			path.join(tmpStorage, ".vscode-mock", "global-storage", VSCODE_CONFIG_SECRETS_FILE),
			JSON.stringify({ openRouterApiKey: "sk-123" }),
		)
		fs.writeFileSync(
			path.join(tmpStorage, ".vscode-mock", "global-storage", VSCODE_CONFIG_GLOBAL_STATE_FILE),
			JSON.stringify({ apiProvider: "openrouter", openRouterModelId: "anthropic/claude-opus-4.6" }),
		)

		const config = readVsCodeConfig()
		expect(config?.provider).toBe("openrouter")
		expect(config?.model).toBe("anthropic/claude-opus-4.6")
		expect(config?.apiKey).toBe("sk-123")
	})

	it("reads from the v2 provider-profiles envelope", () => {
		fs.mkdirSync(path.join(tmpStorage, ".vscode-mock", "global-storage"), { recursive: true })
		const envelope = JSON.stringify({
			schemaVersion: 2,
			data: {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {
						id: "abc123",
						provider: {
							providerId: "anthropic",
							config: { apiModelId: "claude-opus-4", anthropicBaseUrl: "https://proxy.example" },
						},
					},
				},
			},
		})
		fs.writeFileSync(
			path.join(tmpStorage, ".vscode-mock", "global-storage", VSCODE_CONFIG_SECRETS_FILE),
			JSON.stringify({ roo_cline_config_api_config: envelope }),
		)

		const config = readVsCodeConfig()
		expect(config?.provider).toBe("anthropic")
		expect(config?.model).toBe("claude-opus-4")
		expect(config?.baseUrl).toBe("https://proxy.example")
	})

	it("does not surface retired/unsupported providers", () => {
		fs.mkdirSync(path.join(tmpStorage, ".vscode-mock", "global-storage"), { recursive: true })
		fs.writeFileSync(
			path.join(tmpStorage, ".vscode-mock", "global-storage", VSCODE_CONFIG_GLOBAL_STATE_FILE),
			JSON.stringify({ apiProvider: "groq", openRouterModelId: "x" }),
		)

		expect(readVsCodeConfig()).toBeUndefined()
	})

	it("ignores vscode-lm (unsupported in the CLI)", () => {
		fs.mkdirSync(path.join(tmpStorage, ".vscode-mock", "global-storage"), { recursive: true })
		fs.writeFileSync(
			path.join(tmpStorage, ".vscode-mock", "global-storage", VSCODE_CONFIG_GLOBAL_STATE_FILE),
			JSON.stringify({ apiProvider: "vscode-lm" }),
		)

		expect(readVsCodeConfig()).toBeUndefined()
	})

	it("returns undefined when vscode-lm in the secret store envelope", () => {
		fs.mkdirSync(path.join(tmpStorage, ".vscode-mock", "global-storage"), { recursive: true })
		fs.writeFileSync(
			path.join(tmpStorage, ".vscode-mock", "global-storage", VSCODE_CONFIG_SECRETS_FILE),
			JSON.stringify({ roo_cline_config_api_config: V1_ENVELOPE }),
		)

		// V1_ENVELOPE has no apiProvider — undefined.
		expect(readVsCodeConfig()).toBeUndefined()
	})
})
