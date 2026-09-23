import fs from "fs"
import path from "path"
import os from "os"

import { openAiModelInfoSaneDefaults } from "@roo-code/types"

import { providerRequiresApiKey, getEnvVarName, keylessProviders, getBaseUrlField } from "@/lib/utils/provider-types.js"

import { run } from "../run.js"
import { loadSettings, saveSettings, getSettingsPath } from "@/lib/storage/settings.js"
import { getConfigDir } from "@/lib/storage/config-dir.js"
import type { FlagOptions } from "@/types/index.js"
import { CLEAR_SCREEN } from "@/ui/utils/clearTerminal.js"

const mockGetOpenAiCodexAuthStatus = vi.hoisted(() => vi.fn(async () => ({ authenticated: true })))

// Point the real settings storage at a temp dir via the leaf config-dir module.
// The factory needs a concrete default: other storage modules call
// getConfigDir() at import time (credentials.ts computes its file path).
vi.mock("@/lib/storage/config-dir.js", () => ({
	getConfigDir: vi.fn(() => path.join(os.tmpdir(), "cli-config-dir-default")),
}))

// Keep the run deterministic: no VS Code state on disk may leak a provider in.
vi.mock("@/lib/utils/vscode-config.js", () => ({
	readVsCodeConfig: vi.fn(() => undefined),
}))

vi.mock("@/commands/auth/openai-codex.js", () => ({
	getOpenAiCodexAuthStatus: mockGetOpenAiCodexAuthStatus,
}))

// Capture what the extension host is constructed with, without booting the
// real extension bundle.
const mockHost = vi.hoisted(() => ({
	lastOptions: undefined as
		| undefined
		| {
				provider?: string
				workspacePath?: string
				model?: string
				baseUrl?: string
				mode?: string
				reasoningEffort?: string
				apiKey?: string
				contextWindow?: number
				commandExecutionTimeout?: number
				mcpSettingsPath?: string
				modeProviderSettings?: {
					base: Record<string, unknown>
					modes: Record<string, Record<string, unknown>>
				}
		  },
}))

vi.mock("@/agent/index.js", () => {
	class MockExtensionHost {
		constructor(options: unknown) {
			mockHost.lastOptions = options as { provider?: string }
		}

		async activate(): Promise<void> {}
		async runTask(): Promise<void> {}
		async resumeTask(): Promise<void> {}
		async dispose(): Promise<void> {}
	}

	return { ExtensionHost: MockExtensionHost }
})

// The interactive branch imports ink and the App lazily. Keep ink real except
// for `render`, so no frame is ever drawn, and stub the App so the whole UI
// tree is not loaded for a test about the startup sequence.
vi.mock("ink", async (importOriginal) => ({
	...(await importOriginal<typeof import("ink")>()),
	render: vi.fn(() => ({ unmount: () => {}, waitUntilExit: async () => {} })),
}))

vi.mock("@/ui/App.js", () => ({ App: () => null }))

const mockGetConfigDir = getConfigDir as unknown as ReturnType<typeof vi.fn>

function baseFlags(overrides: Partial<FlagOptions> = {}): FlagOptions {
	return {
		promptFile: undefined,
		createWithSessionId: undefined,
		sessionId: undefined,
		continue: false,
		workspace: undefined,
		print: true,
		stdinPromptStream: false,
		signalOnlyExit: false,
		extension: undefined,
		debug: false,
		requireApproval: false,
		exitOnError: false,
		apiKey: "test-key",
		provider: undefined,
		model: undefined,
		baseUrl: undefined,
		mode: undefined,
		terminalShell: undefined,
		reasoningEffort: undefined,
		consecutiveMistakeLimit: undefined,
		commandExecutionTimeout: undefined,
		ephemeral: false,
		oneshot: false,
		outputFormat: undefined,
		...overrides,
	}
}

describe("provider-aware API-key gate", () => {
	it("keyless providers do not require a key", () => {
		expect(providerRequiresApiKey("ollama")).toBe(false)
		expect(providerRequiresApiKey("lmstudio")).toBe(false)
		expect(providerRequiresApiKey("bedrock")).toBe(false)
		expect(providerRequiresApiKey("qwen-code")).toBe(false)
		expect(providerRequiresApiKey("vertex")).toBe(false)
		expect(providerRequiresApiKey("openai-codex")).toBe(false)
	})

	it("every keyless provider is listed in keylessProviders", () => {
		for (const provider of ["ollama", "lmstudio", "bedrock", "qwen-code", "vertex", "openai-codex"]) {
			expect(keylessProviders).toContain(provider)
		}
	})

	it("keyed providers require a key and expose its env var", () => {
		expect(providerRequiresApiKey("anthropic")).toBe(true)
		expect(providerRequiresApiKey("openrouter")).toBe(true)
		expect(getEnvVarName("openrouter")).toBe("OPENROUTER_API_KEY")
		expect(getEnvVarName("lmstudio")).toBeNull()
	})
})

describe("run OpenAI Codex OAuth configuration", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-codex-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
		mockGetOpenAiCodexAuthStatus.mockResolvedValue({ authenticated: true })
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("runs keyless with the provider-specific default model", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)
		try {
			await run("hello", baseFlags({ provider: "openai-codex", apiKey: undefined }))
			expect(mockHost.lastOptions?.provider).toBe("openai-codex")
			expect(mockHost.lastOptions?.model).toBe("gpt-5.6-sol")
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("rejects ephemeral mode because it cannot see the persistent OAuth login", async () => {
		const exitError = new Error("process.exit")
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw exitError
		}) as unknown as typeof process.exit)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			await expect(
				run("hello", baseFlags({ provider: "openai-codex", apiKey: undefined, ephemeral: true })),
			).rejects.toBe(exitError)
			expect(errorSpy).toHaveBeenCalledWith(
				"[CLI] Error: --ephemeral cannot be used with the openai-codex provider.",
			)
		} finally {
			exitSpy.mockRestore()
			errorSpy.mockRestore()
		}
	})

	it("rejects a normal run until the subscription login has completed", async () => {
		mockGetOpenAiCodexAuthStatus.mockResolvedValue({ authenticated: false })
		const exitError = new Error("process.exit")
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw exitError
		}) as unknown as typeof process.exit)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			await expect(run("hello", baseFlags({ provider: "openai-codex", apiKey: undefined }))).rejects.toBe(
				exitError,
			)
			expect(errorSpy).toHaveBeenCalledWith("[CLI] Error: OpenAI Codex is not authenticated.")
			expect(mockHost.lastOptions).toBeUndefined()
		} finally {
			exitSpy.mockRestore()
			errorSpy.mockRestore()
		}
	})
})

describe("run command --prompt-file option", () => {
	let tempDir: string
	let promptFilePath: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"))
		promptFilePath = path.join(tempDir, "prompt.md")
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("should read prompt from file when --prompt-file is provided", () => {
		const promptContent = `This is a test prompt with special characters:
- Quotes: "hello" and 'world'
- Backticks: \`code\`
- Newlines and tabs
- Unicode: 你好 🎉`

		fs.writeFileSync(promptFilePath, promptContent)

		// Verify the file was written correctly
		const readContent = fs.readFileSync(promptFilePath, "utf-8")
		expect(readContent).toBe(promptContent)
	})

	it("should handle multi-line prompts correctly", () => {
		const multiLinePrompt = `Line 1
Line 2
Line 3

Empty line above
\tTabbed line
  Indented line`

		fs.writeFileSync(promptFilePath, multiLinePrompt)
		const readContent = fs.readFileSync(promptFilePath, "utf-8")

		expect(readContent).toBe(multiLinePrompt)
		expect(readContent.split("\n")).toHaveLength(7)
	})

	it("should handle very long prompts that would exceed ARG_MAX", () => {
		// ARG_MAX is typically 128KB-2MB, so let's test with a 500KB prompt
		const longPrompt = "x".repeat(500 * 1024)

		fs.writeFileSync(promptFilePath, longPrompt)
		const readContent = fs.readFileSync(promptFilePath, "utf-8")

		expect(readContent.length).toBe(500 * 1024)
		expect(readContent).toBe(longPrompt)
	})

	it("should preserve shell-sensitive characters", () => {
		const shellSensitivePrompt = `
$HOME
$(echo dangerous)
\`rm -rf /\`
"quoted string"
'single quoted'
$((1+1))
&&
||
;
> /dev/null
< input.txt
| grep something
*
?
[abc]
{a,b}
~
!
#comment
%s
\n\t\r
`

		fs.writeFileSync(promptFilePath, shellSensitivePrompt)
		const readContent = fs.readFileSync(promptFilePath, "utf-8")

		// All shell-sensitive characters should be preserved exactly
		expect(readContent).toBe(shellSensitivePrompt)
		expect(readContent).toContain("$HOME")
		expect(readContent).toContain("$(echo dangerous)")
		expect(readContent).toContain("`rm -rf /`")
	})
})

describe("run never writes cli-settings.json", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-readonly-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
		mockGetOpenAiCodexAuthStatus.mockResolvedValue({ authenticated: true })
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	function snapshotSettingsFile() {
		return { raw: fs.readFileSync(getSettingsPath(), "utf-8"), mtimeMs: fs.statSync(getSettingsPath()).mtimeMs }
	}

	it("a bare run leaves the file byte-identical", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({ provider: "openai", model: "DeepSeek-V4-Flash-0731" })
			const before = snapshotSettingsFile()

			await run("hello", baseFlags())

			expect(mockHost.lastOptions?.model).toBe("DeepSeek-V4-Flash-0731")
			expect(snapshotSettingsFile()).toEqual(before)
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("provider, model, base-url and reasoning-effort flags apply to this run only", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({ provider: "openrouter", model: "openai/gpt-4o" })
			const before = snapshotSettingsFile()

			await run(
				"hello",
				baseFlags({
					provider: "openai",
					model: "my-custom-model",
					baseUrl: "http://localhost:1234/v1",
					reasoningEffort: "high",
				}),
			)

			expect(mockHost.lastOptions).toMatchObject({
				provider: "openai",
				model: "my-custom-model",
				baseUrl: "http://localhost:1234/v1",
				reasoningEffort: "high",
			})
			expect(snapshotSettingsFile()).toEqual(before)
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("--provider without -m never sends the model saved for another provider", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			// The model in the file belongs to openrouter; switching the run to
			// openai must fall back to the default instead (decision A3).
			await saveSettings({ provider: "openrouter", model: "openai/gpt-4o" })
			const before = snapshotSettingsFile()

			await run("hello", baseFlags({ provider: "openai" }))

			expect(mockHost.lastOptions?.provider).toBe("openai")
			expect(mockHost.lastOptions?.model).not.toBe("openai/gpt-4o")
			expect(snapshotSettingsFile()).toEqual(before)
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("--provider tumble resolves to openrouter without writing the file", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await run("hello", baseFlags({ provider: "tumble" as unknown as FlagOptions["provider"] }))

			expect(mockHost.lastOptions?.provider).toBe("openrouter")
			expect(fs.existsSync(getSettingsPath())).toBe(false)
		} finally {
			exitSpy.mockRestore()
		}
	})
})

describe("run baseUrl resolution", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-baseurl-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
		mockGetOpenAiCodexAuthStatus.mockResolvedValue({ authenticated: true })
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("openai baseUrl from settings is forwarded into the ExtensionHostOptions (bug 3)", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			// The user's ~/.roo/cli-settings.json declares openai + baseUrl —
			// the effective baseUrl must reach the extension host so the
			// OpenAiHandler builds the URL against the custom backend, never
			// against https://api.openai.com/v1.
			await saveSettings({ provider: "openai", baseUrl: "http://192.168.50.194:11111/v1" })

			await run("hello", baseFlags())

			expect(mockHost.lastOptions?.provider).toBe("openai")
			expect(mockHost.lastOptions?.baseUrl).toBe("http://192.168.50.194:11111/v1")
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("rejects --base-url for a provider without a base-url field", async () => {
		const exitError = new Error("process.exit")
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw exitError
		}) as unknown as typeof process.exit)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		try {
			// xai has no base-url field at all (its schema has no base-url key).
			expect(getBaseUrlField("xai")).toBeUndefined()

			await expect(
				run("hello", baseFlags({ provider: "xai", apiKey: "xai-key", baseUrl: "http://nope" })),
			).rejects.toBe(exitError)

			expect(exitSpy).toHaveBeenCalledWith(1)
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("does not support a base URL"))
		} finally {
			exitSpy.mockRestore()
			errorSpy.mockRestore()
		}
	})

	it("drops a stale OpenAI-compatible baseUrl when switching to OpenAI Codex", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({
				provider: "openai",
				model: "local-model",
				baseUrl: "http://localhost:1234/v1",
			})

			await run("hello", baseFlags({ provider: "openai-codex" }))

			expect(mockHost.lastOptions?.provider).toBe("openai-codex")
			expect(mockHost.lastOptions?.baseUrl).toBeUndefined()
			const after = await loadSettings()
			expect(after.provider).toBe("openai")
			expect(after.baseUrl).toBe("http://localhost:1234/v1")
		} finally {
			exitSpy.mockRestore()
		}
	})
})

describe("run bare-run defaults", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("bare run (no -w) uses the current working directory as workspace", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			// Save a provider first so the run is valid (bare `tumble` reads settings).
			await saveSettings({ provider: "openrouter" })

			await run("hello", baseFlags({ workspace: undefined }))

			// -w is undefined → process.cwd() must be used, never a persisted workspace.
			expect(mockHost.lastOptions?.workspacePath).toBe(process.cwd())
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("persisted settings drive a bare run: no -w/--provider/--model flags needed", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({ provider: "openrouter", model: "openai/gpt-4o" })

			await run("hello", baseFlags({ workspace: undefined }))

			// Provider and model come from cli-settings.json (no flags given).
			expect(mockHost.lastOptions?.provider).toBe("openrouter")
			expect(mockHost.lastOptions?.model).toBe("openai/gpt-4o")
			expect(mockHost.lastOptions?.workspacePath).toBe(process.cwd())
		} finally {
			exitSpy.mockRestore()
		}
	})
})

describe("run mode and reasoning effort come from settings when no flag is given", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-defaults-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("uses the settings mode and reasoning effort on a bare run", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({ provider: "openrouter", mode: "architect", reasoningEffort: "max" })

			await run("hello", baseFlags())

			expect(mockHost.lastOptions?.mode).toBe("architect")
			expect(mockHost.lastOptions?.reasoningEffort).toBe("max")
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("explicit flags win over the settings values", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({ provider: "openrouter", mode: "architect", reasoningEffort: "max" })

			await run("hello", baseFlags({ mode: "ask", reasoningEffort: "low" }))

			expect(mockHost.lastOptions?.mode).toBe("ask")
			expect(mockHost.lastOptions?.reasoningEffort).toBe("low")
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("falls back to code and medium without flags or settings", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({ provider: "openrouter" })

			await run("hello", baseFlags())

			expect(mockHost.lastOptions?.mode).toBe("code")
			expect(mockHost.lastOptions?.reasoningEffort).toBe("medium")
		} finally {
			exitSpy.mockRestore()
		}
	})
})

describe("run API key from the settings file", () => {
	let tempDir: string
	const savedEnv = { ...process.env }

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-apikey-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
		delete process.env.OPENAI_API_KEY
		delete process.env.LOCAL_LLM_KEY
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
		process.env = { ...savedEnv }
	})

	it("a bare run needs no --api-key when the settings hold apiKey", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({
				provider: "openai",
				baseUrl: "http://192.168.50.194:11111/v1",
				model: "GLM-5.3-Flash-NVFP4",
				apiKey: "1111",
				reasoningEffort: "max",
			})

			await run("hello", baseFlags({ apiKey: undefined }))

			expect(exitSpy).not.toHaveBeenCalledWith(1)
			expect(mockHost.lastOptions).toMatchObject({
				provider: "openai",
				baseUrl: "http://192.168.50.194:11111/v1",
				model: "GLM-5.3-Flash-NVFP4",
				apiKey: "1111",
				reasoningEffort: "max",
			})
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("reads the key from the variable named by apiKeyEnv", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			process.env.LOCAL_LLM_KEY = "from-env"
			await saveSettings({ provider: "openai", apiKeyEnv: "LOCAL_LLM_KEY" })

			await run("hello", baseFlags({ apiKey: undefined }))

			expect(mockHost.lastOptions?.apiKey).toBe("from-env")
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("names the unset apiKeyEnv variable when it is missing", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		try {
			await saveSettings({ provider: "openai", apiKeyEnv: "LOCAL_LLM_KEY" })

			await run("hello", baseFlags({ apiKey: undefined }))

			expect(exitSpy).toHaveBeenCalledWith(1)
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("LOCAL_LLM_KEY"))
		} finally {
			exitSpy.mockRestore()
			errorSpy.mockRestore()
		}
	})
})

describe("run provider settings per mode", () => {
	let tempDir: string
	const savedEnv = { ...process.env }

	const globalSettings = {
		provider: "openai" as const,
		baseUrl: "http://192.168.50.194:11111/v1",
		model: "GLM-5.3-Flash-NVFP4",
		apiKey: "1111",
		reasoningEffort: "max" as const,
	}

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-modes-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
		mockGetOpenAiCodexAuthStatus.mockResolvedValue({ authenticated: true })
		delete process.env.OPENAI_API_KEY
		delete process.env.ANTHROPIC_API_KEY
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
		process.env = { ...savedEnv }
	})

	/** Runs until the first process.exit and reports its code (print mode always exits). */
	async function runWithExitThrowing(flags: Partial<FlagOptions> = {}) {
		const exitError = new Error("process.exit")
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw exitError
		}) as unknown as typeof process.exit)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		try {
			await run("hello", baseFlags({ apiKey: undefined, ...flags })).catch((error) => {
				if (error !== exitError) throw error
			})
			const outcome = exitSpy.mock.calls[0]?.[0] === 1 ? "failed" : "ran"
			return { outcome, errors: errorSpy.mock.calls.map((call) => String(call[0])) }
		} finally {
			exitSpy.mockRestore()
			errorSpy.mockRestore()
		}
	}

	it("a mode entry changes only what it names and inherits the rest", async () => {
		await saveSettings({
			...globalSettings,
			modes: { architect: { model: "GLM-5.3-NVFP4", reasoningEffort: "high" } },
		})

		const { outcome } = await runWithExitThrowing()

		expect(outcome).toBe("ran")
		expect(mockHost.lastOptions?.modeProviderSettings).toEqual({
			base: {
				apiProvider: "openai",
				openAiBaseUrl: "http://192.168.50.194:11111/v1",
				openAiModelId: "GLM-5.3-Flash-NVFP4",
				openAiApiKey: "1111",
				enableReasoningEffort: true,
				reasoningEffort: "max",
				openAiCustomModelInfo: null,
			},
			modes: {
				architect: {
					apiProvider: "openai",
					openAiBaseUrl: "http://192.168.50.194:11111/v1",
					openAiModelId: "GLM-5.3-NVFP4",
					openAiApiKey: "1111",
					enableReasoningEffort: true,
					reasoningEffort: "high",
					openAiCustomModelInfo: null,
				},
			},
		})
	})

	it("a mode entry naming another provider carries over no model, base URL or key", async () => {
		await saveSettings({ ...globalSettings, modes: { ask: { provider: "openai-codex" } } })

		const { outcome } = await runWithExitThrowing()

		expect(outcome).toBe("ran")
		expect(mockHost.lastOptions?.modeProviderSettings?.modes.ask).toEqual({
			apiProvider: "openai-codex",
			apiModelId: "gpt-5.6-sol",
			enableReasoningEffort: true,
			reasoningEffort: "max",
		})
	})

	it("the session starts with the entry of the mode it starts in", async () => {
		await saveSettings({
			...globalSettings,
			mode: "architect",
			modes: { architect: { model: "GLM-5.3-NVFP4", reasoningEffort: "high" } },
		})

		await runWithExitThrowing()

		expect(mockHost.lastOptions).toMatchObject({
			mode: "architect",
			model: "GLM-5.3-NVFP4",
			reasoningEffort: "high",
			apiKey: "1111",
		})
	})

	it("sends the base settings even without mode entries, so no mode falls back to a stored profile", async () => {
		await saveSettings(globalSettings)

		await runWithExitThrowing()

		expect(mockHost.lastOptions?.modeProviderSettings?.modes).toEqual({})
		expect(mockHost.lastOptions?.modeProviderSettings?.base).toMatchObject({ openAiModelId: "GLM-5.3-Flash-NVFP4" })
	})

	it("any provider flag uses one configuration for every mode", async () => {
		await saveSettings({ ...globalSettings, modes: { architect: { model: "GLM-5.3-NVFP4" } } })

		await runWithExitThrowing({ model: "Qwen3.8-27B" })

		expect(mockHost.lastOptions?.model).toBe("Qwen3.8-27B")
		expect(mockHost.lastOptions?.modeProviderSettings?.modes).toEqual({})
		expect(mockHost.lastOptions?.modeProviderSettings?.base).toMatchObject({ openAiModelId: "Qwen3.8-27B" })
	})

	it("a broken mode entry fails at startup and names the mode", async () => {
		await saveSettings({ ...globalSettings, modes: { debug: { provider: "anthropic" } } })

		const { outcome, errors } = await runWithExitThrowing()

		expect(outcome).toBe("failed")
		expect(errors[0]).toContain("modes.debug")
		expect(errors[0]).toContain("No API key provided")
		expect(mockHost.lastOptions).toBeUndefined()
	})

	it("a mode entry with an invalid reasoning effort fails at startup", async () => {
		await saveSettings({
			...globalSettings,
			modes: { architect: { reasoningEffort: "maz" as never } },
		})

		const { outcome, errors } = await runWithExitThrowing()

		expect(outcome).toBe("failed")
		expect(errors[0]).toContain("modes.architect")
		expect(errors[0]).toContain("Invalid reasoning effort: maz")
	})
})

describe("run context window per model", () => {
	let tempDir: string
	const savedEnv = { ...process.env }

	const globalSettings = {
		provider: "openai" as const,
		baseUrl: "http://192.168.50.194:11111/v1",
		model: "GLM-5.3-NVFP4",
		apiKey: "1111",
	}

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-models-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
		delete process.env.OPENAI_API_KEY
		delete process.env.ANTHROPIC_API_KEY
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
		process.env = { ...savedEnv }
	})

	async function runWithExitThrowing(flags: Partial<FlagOptions> = {}) {
		const exitError = new Error("process.exit")
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw exitError
		}) as unknown as typeof process.exit)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		try {
			await run("hello", baseFlags({ apiKey: undefined, ...flags })).catch((error) => {
				if (error !== exitError) throw error
			})
			const outcome = exitSpy.mock.calls[0]?.[0] === 1 ? "failed" : "ran"
			return {
				outcome,
				errors: errorSpy.mock.calls.map((call) => String(call[0])),
				warnings: warnSpy.mock.calls.map((call) => String(call[0])),
			}
		} finally {
			exitSpy.mockRestore()
			errorSpy.mockRestore()
			warnSpy.mockRestore()
		}
	}

	const sized = (contextWindow: number) => ({ ...openAiModelInfoSaneDefaults, contextWindow })

	it("sizes the model everywhere it runs: the session, the global settings and each mode", async () => {
		await saveSettings({
			...globalSettings,
			modes: { ask: { model: "GLM-5.3-Flash-NVFP4" }, architect: { reasoningEffort: "high" } },
			models: { "GLM-5.3-NVFP4": { contextWindow: 262_144 } },
		})

		const { outcome } = await runWithExitThrowing()

		expect(outcome).toBe("ran")
		expect(mockHost.lastOptions?.contextWindow).toBe(262_144)
		expect(mockHost.lastOptions?.modeProviderSettings?.base.openAiCustomModelInfo).toEqual(sized(262_144))
		expect(mockHost.lastOptions?.modeProviderSettings?.modes.architect?.openAiCustomModelInfo).toEqual(
			sized(262_144),
		)
		// Another model, no entry: the provider's default applies.
		expect(mockHost.lastOptions?.modeProviderSettings?.modes.ask?.openAiCustomModelInfo).toBeNull()
	})

	it("follows --model", async () => {
		await saveSettings({ ...globalSettings, models: { "Qwen3.8-27B": { contextWindow: 65_536 } } })

		await runWithExitThrowing({ model: "Qwen3.8-27B" })

		expect(mockHost.lastOptions?.contextWindow).toBe(65_536)
		expect(mockHost.lastOptions?.modeProviderSettings?.base.openAiCustomModelInfo).toEqual(sized(65_536))
	})

	it("a malformed size fails at startup and names the model", async () => {
		await saveSettings({ ...globalSettings, models: { "GLM-5.3-NVFP4": { contextWindow: "262k" as never } } })

		const { outcome, errors } = await runWithExitThrowing()

		expect(outcome).toBe("failed")
		expect(errors[0]).toContain("models.GLM-5.3-NVFP4.contextWindow must be a whole number of tokens")
		expect(mockHost.lastOptions).toBeUndefined()
	})

	it("warns once that a size is ignored on a provider that sizes its models itself", async () => {
		process.env.ANTHROPIC_API_KEY = "k"
		await saveSettings({
			provider: "anthropic",
			model: "claude-x",
			modes: { ask: { reasoningEffort: "low" } },
			models: { "claude-x": { contextWindow: 1_000_000 } },
		})

		const { outcome, warnings } = await runWithExitThrowing()

		expect(outcome).toBe("ran")
		const ignored = warnings.filter((warning) => warning.includes("models.claude-x.contextWindow"))
		expect(ignored).toHaveLength(1)
		expect(ignored[0]).toContain("ignored with the anthropic provider")
		expect(mockHost.lastOptions?.modeProviderSettings?.base).not.toHaveProperty("openAiCustomModelInfo")
	})
})

describe("run command execution timeout", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-command-timeout-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	async function runWithExitThrowing(flags: Partial<FlagOptions> = {}) {
		const exitError = new Error("process.exit")
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw exitError
		}) as unknown as typeof process.exit)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		try {
			await run("hello", baseFlags(flags)).catch((error) => {
				if (error !== exitError) throw error
			})
			const outcome = exitSpy.mock.calls[0]?.[0] === 1 ? "failed" : "ran"
			return { outcome, errors: errorSpy.mock.calls.map((call) => String(call[0])) }
		} finally {
			exitSpy.mockRestore()
			errorSpy.mockRestore()
		}
	}

	it("defaults to 300 seconds", async () => {
		await saveSettings({ provider: "openrouter" })

		await runWithExitThrowing()

		expect(mockHost.lastOptions?.commandExecutionTimeout).toBe(300)
	})

	it("takes the settings value, and 0 for no limit", async () => {
		await saveSettings({ provider: "openrouter", commandExecutionTimeout: 1800 })
		await runWithExitThrowing()
		expect(mockHost.lastOptions?.commandExecutionTimeout).toBe(1800)

		await saveSettings({ provider: "openrouter", commandExecutionTimeout: 0 })
		await runWithExitThrowing()
		expect(mockHost.lastOptions?.commandExecutionTimeout).toBe(0)
	})

	it("the flag wins over the settings value", async () => {
		await saveSettings({ provider: "openrouter", commandExecutionTimeout: 1800 })

		await runWithExitThrowing({ commandExecutionTimeout: "3600" })

		expect(mockHost.lastOptions?.commandExecutionTimeout).toBe(3600)
	})

	it.each(["10m", "", "-1", "1.5"])("rejects the flag value %j and names the flag", async (value) => {
		await saveSettings({ provider: "openrouter" })

		const { outcome, errors } = await runWithExitThrowing({ commandExecutionTimeout: value })

		expect(outcome).toBe("failed")
		expect(errors[0]).toContain("--command-execution-timeout must be a whole number of seconds")
		expect(mockHost.lastOptions).toBeUndefined()
	})

	it("rejects a malformed settings value and names the settings file", async () => {
		await saveSettings({ provider: "openrouter", commandExecutionTimeout: "10m" as never })

		const { outcome, errors } = await runWithExitThrowing()

		expect(outcome).toBe("failed")
		expect(errors[0]).toContain(`commandExecutionTimeout in ${getSettingsPath()} must be a whole number of seconds`)
		expect(mockHost.lastOptions).toBeUndefined()
	})

	it("rejects a value too large for a timer, which would stop every command at once", async () => {
		await saveSettings({ provider: "openrouter" })

		const atMax = await runWithExitThrowing({ commandExecutionTimeout: "2147483" })
		expect(atMax.outcome).toBe("ran")
		expect(mockHost.lastOptions?.commandExecutionTimeout).toBe(2_147_483)

		mockHost.lastOptions = undefined
		const aboveMax = await runWithExitThrowing({ commandExecutionTimeout: "2147484" })
		expect(aboveMax.outcome).toBe("failed")
		expect(aboveMax.errors[0]).toContain("from 0 (no limit) to 2147483")
		expect(mockHost.lastOptions).toBeUndefined()
	})
})

describe("run global MCP settings file", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("defaults to mcp.json next to cli-settings.json", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({ provider: "openrouter" })

			await run("hello", baseFlags())

			expect(mockHost.lastOptions?.mcpSettingsPath).toBe(path.join(tempDir, "mcp.json"))
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("uses mcpSettingsPath from the settings file", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({ provider: "openrouter", mcpSettingsPath: "~/shared/mcp_settings.json" })

			await run("hello", baseFlags())

			expect(mockHost.lastOptions?.mcpSettingsPath).toBe(path.join(os.homedir(), "shared", "mcp_settings.json"))
		} finally {
			exitSpy.mockRestore()
		}
	})
})

describe("run clears the screen when the interactive UI starts", () => {
	let tempDir: string
	const stdinWasTTY = process.stdin.isTTY
	const stdoutWasTTY = process.stdout.isTTY

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		process.stdin.isTTY = true
		process.stdout.isTTY = true
	})

	afterEach(() => {
		process.stdin.isTTY = stdinWasTTY
		process.stdout.isTTY = stdoutWasTTY
		vi.restoreAllMocks()
		mockGetConfigDir.mockReset()
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("erases the screen, but not the scrollback, before any startup warning", async () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)
		await saveSettings({ provider: "openrouter" })

		// A relative --terminal-shell is ignored with a warning on every platform.
		await run("hello", baseFlags({ print: false, terminalShell: "not-absolute" }))

		expect(writeSpy).toHaveBeenCalledWith(CLEAR_SCREEN)
		expect(writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("")).not.toContain("\x1b[3J")

		const clearOrder = writeSpy.mock.invocationCallOrder[writeSpy.mock.calls.findIndex(([c]) => c === CLEAR_SCREEN)]
		const warningIndex = errorSpy.mock.calls.findIndex(([line]) => String(line).includes("--terminal-shell"))
		expect(warningIndex).toBeGreaterThanOrEqual(0)
		expect(clearOrder).toBeLessThan(errorSpy.mock.invocationCallOrder[warningIndex]!)
	})

	it("leaves the screen alone in print mode", async () => {
		// Print mode flushes with `write("", callback)` and waits for the callback.
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
			_chunk: unknown,
			encodingOrCallback?: unknown,
			callback?: unknown,
		) => {
			const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback
			;(done as (() => void) | undefined)?.()
			return true
		}) as typeof process.stdout.write)
		vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)
		await saveSettings({ provider: "openrouter" })

		await run("hello", baseFlags({ print: true }))

		expect(writeSpy).not.toHaveBeenCalledWith(CLEAR_SCREEN)
	})
})
