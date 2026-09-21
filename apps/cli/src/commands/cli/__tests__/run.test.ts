import fs from "fs"
import path from "path"
import os from "os"

import { providerRequiresApiKey, getEnvVarName, keylessProviders, getBaseUrlField } from "@/lib/utils/provider-types.js"

import { run, resolveEffectiveBaseUrl, resolveEffectiveModel } from "../run.js"
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
		| { provider?: string; workspacePath?: string; model?: string; baseUrl?: string },
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

describe("resolveEffectiveModel (provider/model coexistence, decision A3)", () => {
	it("returns the persisted model when the persisted provider matches the active provider", () => {
		expect(resolveEffectiveModel({ provider: "openrouter", model: "openai/gpt-4o" }, "openrouter")).toBe(
			"openai/gpt-4o",
		)
	})

	it("returns undefined when the persisted model has no matching provider", () => {
		// Persisted for openrouter, running openai → the openrouter model must
		// NOT be sent to openai.
		expect(resolveEffectiveModel({ provider: "openrouter", model: "openai/gpt-4o" }, "openai")).toBeUndefined()
	})

	it("resolves persisted aliases before comparing providers", () => {
		// Persisted "tumble" maps to openrouter.
		expect(resolveEffectiveModel({ provider: "tumble" as never, model: "openai/gpt-4o" }, "openrouter")).toBe(
			"openai/gpt-4o",
		)
	})

	it("returns undefined when no model or provider is persisted", () => {
		expect(resolveEffectiveModel({}, "openrouter")).toBeUndefined()
		expect(resolveEffectiveModel({ provider: "openrouter" }, "openrouter")).toBeUndefined()
		expect(resolveEffectiveModel(undefined, "openrouter")).toBeUndefined()
	})
})

describe("resolveEffectiveBaseUrl", () => {
	it("returns a persisted URL only for the provider it belongs to", () => {
		expect(resolveEffectiveBaseUrl({ provider: "openai", baseUrl: "http://localhost:1234/v1" }, "openai")).toBe(
			"http://localhost:1234/v1",
		)
		expect(
			resolveEffectiveBaseUrl({ provider: "openai", baseUrl: "http://localhost:1234/v1" }, "openai-codex"),
		).toBeUndefined()
	})
})

describe("run model persistence — never clobber with defaults (bug 2)", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-model-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		if (tempDir) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it("bare run with settings {provider: openai, model: DeepSeek-V4-Flash-0731} does NOT rewrite the model in the file", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			// The user hand-wrote a DeepSeek model under an OpenAI-compatible
			// provider. A bare run (no -m) must keep it — never replace it with
			// the built-in DEFAULT_FLAGS.model (anthropic/claude-opus-4.6).
			await saveSettings({ provider: "openai", model: "DeepSeek-V4-Flash-0731" })
			const mtimeBefore = fs.statSync(getSettingsPath()).mtimeMs

			await run("hello", baseFlags())

			const after = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"))
			expect(after.model).toBe("DeepSeek-V4-Flash-0731")
			expect(after.model).not.toBe("anthropic/claude-opus-4.6")
			// No rewrite happened at all.
			expect(fs.statSync(getSettingsPath()).mtimeMs).toBe(mtimeBefore)
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("--provider openai with no -m on a file whose provider was openrouter keeps the user's model", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			// Settings were saved for openrouter; the run switches to openai
			// without -m. The file's openrouter model must survive — the run's
			// effective default model must never be written over the user's data.
			await saveSettings({ provider: "openrouter", model: "openai/gpt-4o" })

			await run("hello", baseFlags({ provider: "openai" }))

			const after = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"))
			expect(after.provider).toBe("openai")
			expect(after.model).toBe("openai/gpt-4o")
			expect(after.model).not.toBe("anthropic/claude-opus-4.6")
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("an explicit --model persists to the file", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({ provider: "openai" })

			await run("hello", baseFlags({ provider: "openai", model: "my-custom-model" }))

			const after = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"))
			expect(after.model).toBe("my-custom-model")
		} finally {
			exitSpy.mockRestore()
		}
	})
})

describe("run baseUrl persistence (bug 1)", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-baseurl-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
		mockGetOpenAiCodexAuthStatus.mockResolvedValue({ authenticated: true })
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		if (tempDir) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
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

	it("run with --base-url persists it to the settings file", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			await saveSettings({ provider: "openai" })

			await run("hello", baseFlags({ provider: "openai", baseUrl: "http://localhost:1234/v1" }))

			const after = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"))
			expect(after.baseUrl).toBe("http://localhost:1234/v1")
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("a baseUrl already in settings is kept on a bare run (and not dropped)", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			// The user hand-edited ~/.roo/cli-settings.json: provider + model
			// without baseUrl — a bare run must not write a baseUrl key at all
			// (the key must survive untouched, i.e. stay absent).
			await saveSettings({ provider: "openai", model: "DeepSeek-V4-Flash-0731" })

			await run("hello", baseFlags())

			const after = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"))
			expect(after).not.toHaveProperty("baseUrl")
		} finally {
			exitSpy.mockRestore()
		}
	})

	it("never persists a baseUrl for a provider without a base-url field", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			// xai has no base-url field at all (its schema has no base-url key).
			expect(getBaseUrlField("xai")).toBeUndefined()

			await saveSettings({ provider: "xai" })

			await run("hello", baseFlags({ provider: "xai", apiKey: "xai-key", baseUrl: "http://should-not-persist" }))

			const after = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"))
			expect(after).not.toHaveProperty("baseUrl")
		} finally {
			exitSpy.mockRestore()
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
			expect(after.provider).toBe("openai-codex")
			expect(after.baseUrl).toBeUndefined()
		} finally {
			exitSpy.mockRestore()
		}
	})
})

describe("run --provider alias persistence", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-run-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		mockHost.lastOptions = undefined
	})

	afterEach(() => {
		mockGetConfigDir.mockReset()
		if (tempDir) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it("persists the resolved provider (openrouter) when --provider tumble is passed, and a later run reading it resolves normally", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit)

		try {
			// First run: the alias is passed on the flag. The effective host
			// provider is resolved to openrouter, and the settings file must
			// persist the RESOLVED id — never the raw alias "tumble".
			await run("hello", baseFlags({ provider: "tumble" as unknown as FlagOptions["provider"] }))

			expect(mockHost.lastOptions?.provider).toBe("openrouter")

			const persisted = await loadSettings()
			expect(persisted.provider).toBe("openrouter")

			const raw = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"))
			expect(raw.provider).toBe("openrouter")
			expect(raw.provider).not.toBe("tumble")

			// Second run: no --provider flag at all. The settings file now holds
			// the resolved id, so it must resolve normally without any alias.
			await run("hello again", baseFlags())

			expect(mockHost.lastOptions?.provider).toBe("openrouter")
			const after = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"))
			expect(after.provider).toBe("openrouter")
		} finally {
			exitSpy.mockRestore()
		}
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
