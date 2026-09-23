import fs from "fs"
import path from "path"
import os from "os"

import { providerRequiresApiKey, getEnvVarName, keylessProviders, getBaseUrlField } from "@/lib/utils/provider-types.js"

import { run } from "../run.js"
import { loadSettings, saveSettings, getSettingsPath } from "@/lib/storage/settings.js"
import { getConfigDir } from "@/lib/storage/config-dir.js"
import type { FlagOptions } from "@/types/index.js"

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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		try {
			// xai has no base-url field at all (its schema has no base-url key).
			expect(getBaseUrlField("xai")).toBeUndefined()

			await run("hello", baseFlags({ provider: "xai", apiKey: "xai-key", baseUrl: "http://nope" }))

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
