import fs from "fs"
import path from "path"
import os from "os"

import { providerRequiresApiKey, getEnvVarName, keylessProviders } from "@/lib/utils/provider-types.js"

import { run, resolveEffectiveModel } from "../run.js"
import { loadSettings, saveSettings, getSettingsPath } from "@/lib/storage/settings.js"
import { getConfigDir } from "@/lib/storage/config-dir.js"
import type { FlagOptions } from "@/types/index.js"

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

// Capture what the extension host is constructed with, without booting the
// real extension bundle.
const mockHost = vi.hoisted(() => ({
	lastOptions: undefined as undefined | { provider?: string; workspacePath?: string; model?: string },
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
	})

	it("every keyless provider is listed in keylessProviders", () => {
		for (const provider of ["ollama", "lmstudio", "bedrock", "qwen-code", "vertex"]) {
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
