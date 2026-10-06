// pnpm --filter @tumble-code/cli test src/agent/__tests__/extension-host.test.ts

import { EventEmitter } from "events"
import fs from "fs"
import os from "os"
import path from "path"

import {
	CLI_RUNTIME_ENV,
	CLI_RUNTIME_GLOBAL_SLOTS,
	clearCliRuntimeGlobals,
	type ExtensionMessage,
	type WebviewMessage,
} from "@tumble-code/types"

import { DEFAULT_FLAGS } from "@/types/index.js"
import { getPermissionSettings } from "@/lib/utils/permissions.js"
import { VERSION } from "@/lib/utils/version.js"

import { type ExtensionHostOptions, ExtensionHost } from "../extension-host.js"
import { ExtensionClient } from "../extension-client.js"
import { AgentLoopState } from "../agent-state.js"

vi.mock("@tumble-code/vscode-shim", () => ({
	createVSCodeAPI: vi.fn(() => ({
		context: { extensionPath: "/test/extension" },
	})),
	setRuntimeConfig: vi.fn(),
	setRuntimeConfigValues: vi.fn(),
}))

vi.mock("@tumble-code/types", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tumble-code/types")>()
	return { ...actual, clearCliRuntimeGlobals: vi.fn(actual.clearCliRuntimeGlobals) }
})

vi.mock("@/lib/storage/index.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/storage/index.js")>()),
	createEphemeralStorageDir: vi.fn(() => Promise.resolve("/tmp/roo-cli-test-ephemeral")),
}))

/**
 * Create a test ExtensionHost with default options.
 */
function createTestHost({
	mode = "code",
	provider = "openrouter",
	model = "test-model",
	...options
}: Partial<ExtensionHostOptions> = {}): ExtensionHost {
	return new ExtensionHost({
		mode,
		provider,
		model,
		workspacePath: "/test/workspace",
		extensionPath: "/test/extension",
		ephemeral: false,
		debug: false,
		exitOnComplete: false,
		...options,
	})
}

// Type for accessing private members
type PrivateHost = Record<string, unknown>

/**
 * Helper to access private members for testing
 */
function getPrivate<T>(host: ExtensionHost, key: string): T {
	return (host as unknown as PrivateHost)[key] as T
}

/**
 * Helper to set private members for testing
 */
function setPrivate(host: ExtensionHost, key: string, value: unknown): void {
	;(host as unknown as PrivateHost)[key] = value
}

/**
 * Helper to call private methods for testing
 * This uses a more permissive type to avoid TypeScript errors with private methods
 */
function callPrivate<T>(host: ExtensionHost, method: string, ...args: unknown[]): T {
	const fn = (host as unknown as PrivateHost)[method] as ((...a: unknown[]) => T) | undefined
	if (!fn) throw new Error(`Method ${method} not found`)
	return fn.apply(host, args)
}

/**
 * Helper to spy on private methods
 * This uses a more permissive type to avoid TypeScript errors with vi.spyOn on private methods
 */
function spyOnPrivate(host: ExtensionHost, method: string) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return vi.spyOn(host as any, method)
}

describe("ExtensionHost", () => {
	const initialRooCliRuntimeEnv = process.env.ROO_CLI_RUNTIME
	const initialMcpSettingsPathEnv = process.env.ROO_MCP_SETTINGS_PATH

	const restoreEnv = () => {
		if (initialRooCliRuntimeEnv === undefined) {
			delete process.env.ROO_CLI_RUNTIME
		} else {
			process.env.ROO_CLI_RUNTIME = initialRooCliRuntimeEnv
		}
		if (initialMcpSettingsPathEnv === undefined) {
			delete process.env.ROO_MCP_SETTINGS_PATH
		} else {
			process.env.ROO_MCP_SETTINGS_PATH = initialMcpSettingsPathEnv
		}
	}

	beforeEach(() => {
		vi.resetAllMocks()
		restoreEnv()
		// Clean up globals
		delete (global as Record<string, unknown>).vscode
		delete (global as Record<string, unknown>).__extensionHost
	})

	afterAll(() => {
		restoreEnv()
	})

	describe("activate", () => {
		let extensionDir: string

		beforeEach(() => {
			// A stand-in bundle: it records when it is activated and reports the
			// webview ready, as the real sidebar registration does.
			extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-host-activate-"))
			fs.writeFileSync(
				path.join(extensionDir, "extension.js"),
				[
					"exports.activate = async () => {",
					'\tglobalThis.__hostActivateOrder.push("activate")',
					'\tglobalThis.__lazyVscode = () => require("vscode")',
					"\tglobalThis.__extensionHost.markWebviewReady()",
					"}",
				].join("\n"),
			)
			;(globalThis as Record<string, unknown>).__hostActivateOrder = []
		})

		afterEach(() => {
			fs.rmSync(extensionDir, { recursive: true, force: true })
			delete (globalThis as Record<string, unknown>).__hostActivateOrder
			delete (globalThis as Record<string, unknown>).__lazyVscode
		})

		// The cloud package requires "vscode" only when the user signs in, long
		// after activation; that require failed once the hook was removed.
		it("lets the extension require vscode lazily after activation, until dispose", async () => {
			const shim = await import("@tumble-code/vscode-shim")
			const vscodeApi = { context: {} }
			vi.mocked(shim.createVSCodeAPI).mockReturnValue(vscodeApi as never)
			const host = createTestHost({ extensionPath: extensionDir })
			const lazyVscode = () => ((globalThis as Record<string, unknown>).__lazyVscode as () => unknown)()

			await host.activate()
			expect(lazyVscode()).toBe(vscodeApi)

			await host.dispose()
			expect(lazyVscode).toThrow(/vscode/)
		})

		it("shows and opens the URLs the extension opens, with the cloud port the shim dropped", async () => {
			const shim = await import("@tumble-code/vscode-shim")
			vi.mocked(shim.createVSCodeAPI).mockReturnValue({ context: {} } as never)
			const openExternal = vi.fn(async () => false)
			const host = createTestHost({
				extensionPath: extensionDir,
				cloudApiUrl: "http://127.0.0.1:8000",
				openExternal,
			})
			const shown: string[] = []
			host.on("openExternalUrl", (url: string) => shown.push(url))

			try {
				await host.activate()
				const options = vi.mocked(shim.createVSCodeAPI).mock.calls[0]?.[3]
				const opened = await options?.openExternal?.("http://127.0.0.1/extension/sign-in?state=s1")

				const expected = "http://127.0.0.1:8000/extension/sign-in?state=s1"
				expect(shown).toEqual([expected])
				expect(openExternal).toHaveBeenCalledWith(expected)
				// The URL is on screen, so the extension goes on waiting.
				expect(opened).toBe(true)
			} finally {
				await host.dispose()
			}
		})

		it("applies cloudApiUrl as the tumble-code.cloudApiUrl setting before the extension activates", async () => {
			const shim = await import("@tumble-code/vscode-shim")
			vi.mocked(shim.createVSCodeAPI).mockReturnValue({ context: {} } as never)
			vi.mocked(shim.setRuntimeConfig).mockImplementation(() => {
				;((globalThis as Record<string, unknown>).__hostActivateOrder as string[]).push("setRuntimeConfig")
			})
			const host = createTestHost({ extensionPath: extensionDir, cloudApiUrl: "https://cloud.example.com" })

			try {
				await host.activate()

				expect(shim.setRuntimeConfig).toHaveBeenCalledWith(
					"tumble-code",
					"cloudApiUrl",
					"https://cloud.example.com",
				)
				expect((globalThis as Record<string, unknown>).__hostActivateOrder).toEqual([
					"setRuntimeConfig",
					"activate",
				])
			} finally {
				await host.dispose()
			}
		})

		it("sets no cloud URL without cloudApiUrl, so TUMBLE_CODE_API_URL keeps applying", async () => {
			const shim = await import("@tumble-code/vscode-shim")
			vi.mocked(shim.createVSCodeAPI).mockReturnValue({ context: {} } as never)
			const host = createTestHost({ extensionPath: extensionDir })

			try {
				await host.activate()

				expect(shim.setRuntimeConfig).not.toHaveBeenCalled()
			} finally {
				await host.dispose()
			}
		})
	})

	describe("constructor", () => {
		it("should store options correctly", () => {
			const options: ExtensionHostOptions = {
				mode: "code",
				workspacePath: "/my/workspace",
				extensionPath: "/my/extension",
				apiKey: "test-key",
				provider: "openrouter",
				model: "test-model",
				ephemeral: false,
				debug: false,
				exitOnComplete: false,
				integrationTest: true, // Set explicitly for testing
			}

			const host = new ExtensionHost(options)

			// Options are stored as-is
			const storedOptions = getPrivate<ExtensionHostOptions>(host, "options")
			expect(storedOptions.mode).toBe(options.mode)
			expect(storedOptions.workspacePath).toBe(options.workspacePath)
			expect(storedOptions.extensionPath).toBe(options.extensionPath)
			expect(storedOptions.integrationTest).toBe(true)
		})

		it("should be an EventEmitter instance", () => {
			const host = createTestHost()
			expect(host).toBeInstanceOf(EventEmitter)
		})

		it("should initialize with default state values", () => {
			const host = createTestHost()

			expect(getPrivate(host, "isReady")).toBe(false)
			expect(getPrivate(host, "vscode")).toBeNull()
			expect(getPrivate(host, "extensionModule")).toBeNull()
		})

		it("should initialize managers", () => {
			const host = createTestHost()

			// Should have client, outputManager, promptManager, and askDispatcher
			expect(getPrivate(host, "client")).toBeDefined()
			expect(getPrivate(host, "outputManager")).toBeDefined()
			expect(getPrivate(host, "promptManager")).toBeDefined()
			expect(getPrivate(host, "askDispatcher")).toBeDefined()
		})

		// Print mode writes the transcript reader's rows; the TUI (and JSON
		// output) disable output and must leave the reader to their own sink.
		it("attaches the print mode printer to the transcript reader only when output is enabled", () => {
			expect(getPrivate(createTestHost(), "printer")).toBeDefined()
			expect(getPrivate(createTestHost({ disableOutput: true }), "printer")).toBeUndefined()
		})

		it("should mark process as CLI runtime", () => {
			delete process.env.ROO_CLI_RUNTIME
			createTestHost()
			expect(process.env.ROO_CLI_RUNTIME).toBe("1")
		})

		it("should publish the CLI version for the extension's telemetry", () => {
			delete process.env.ROO_CLI_VERSION
			createTestHost()
			expect(process.env.ROO_CLI_VERSION).toBe(VERSION)
		})

		it("should point the core at ~/.roo/mcp.json for global MCP servers by default", () => {
			delete process.env.ROO_MCP_SETTINGS_PATH
			createTestHost()
			expect(process.env.ROO_MCP_SETTINGS_PATH).toBe(path.join(os.homedir(), ".roo", "mcp.json"))
		})

		it("should point the core at the configured global MCP settings file", () => {
			createTestHost({ mcpSettingsPath: "/custom/mcp_settings.json" })
			expect(process.env.ROO_MCP_SETTINGS_PATH).toBe("/custom/mcp_settings.json")
		})

		it("should set execaShellPath in initialSettings when terminalShell is provided", () => {
			const host = createTestHost({ terminalShell: "/bin/bash" })
			const emitSpy = vi.spyOn(host, "emit")
			host.markWebviewReady()
			const updateSettingsCall = emitSpy.mock.calls.find(
				(call) =>
					call[0] === "webviewMessage" &&
					typeof call[1] === "object" &&
					call[1] !== null &&
					(call[1] as WebviewMessage).type === "updateSettings",
			)
			expect(updateSettingsCall).toBeDefined()
			const payload = updateSettingsCall?.[1] as WebviewMessage
			expect(payload.updatedSettings?.execaShellPath).toBe("/bin/bash")
		})
	})

	describe("switchModel (/model)", () => {
		const base = {
			apiProvider: "openai" as const,
			openAiBaseUrl: "http://192.168.50.194:11111/v1",
			openAiModelId: "GLM-5.3-NVFP4",
			enableReasoningEffort: true,
			reasoningEffort: "max" as const,
		}

		function sentModeSettings(emitSpy: { mock: { calls: unknown[][] } }) {
			return emitSpy.mock.calls
				.map((call) => call[1] as WebviewMessage)
				.filter((message) => message?.type === "cliModeProviderSettings")
		}

		it("runs the model in that mode only and has the extension apply it at once", () => {
			const host = createTestHost({
				provider: "openai",
				modeProviderSettings: { base, modes: {} },
				models: { "Qwen3.8-27B": { reasoningEffort: "high" } },
			})
			host.markWebviewReady()
			const emitSpy = vi.spyOn(host, "emit")

			const settings = host.switchModel("code", "Qwen3.8-27B")

			expect(settings).toMatchObject({ openAiModelId: "Qwen3.8-27B", reasoningEffort: "high" })
			expect(sentModeSettings(emitSpy)).toEqual([
				{
					type: "cliModeProviderSettings",
					cliModeProviderSettings: { base, modes: { code: settings } },
					bool: true,
				},
			])
		})

		it("keeps --reasoning-effort for the new model", () => {
			const host = createTestHost({
				provider: "openai",
				modeProviderSettings: { base, modes: {} },
				models: { "Qwen3.8-27B": { reasoningEffort: "high" } },
				forcedReasoningEffort: "low",
			})
			host.markWebviewReady()

			expect(host.switchModel("code", "Qwen3.8-27B").reasoningEffort).toBe("low")
		})

		it("a later switch starts from the mode's current entry", () => {
			const host = createTestHost({ provider: "openai", modeProviderSettings: { base, modes: {} } })
			host.markWebviewReady()
			const emitSpy = vi.spyOn(host, "emit")

			host.switchModel("code", "Qwen3.8-27B")
			host.switchModel("architect", "GLM-5.3-Flash-NVFP4")

			const last = sentModeSettings(emitSpy).at(-1)?.cliModeProviderSettings
			expect(last?.modes.code?.openAiModelId).toBe("Qwen3.8-27B")
			expect(last?.modes.architect?.openAiModelId).toBe("GLM-5.3-Flash-NVFP4")
			expect(last?.base).toBe(base)
		})
	})

	describe("webview provider registration", () => {
		it("should register webview provider without throwing", () => {
			const host = createTestHost()
			const mockProvider = { resolveWebviewView: vi.fn() }

			// registerWebviewProvider is now a no-op, just ensure it doesn't throw
			expect(() => {
				host.registerWebviewProvider("test-view", mockProvider)
			}).not.toThrow()
		})

		it("should unregister webview provider without throwing", () => {
			const host = createTestHost()
			const mockProvider = { resolveWebviewView: vi.fn() }

			host.registerWebviewProvider("test-view", mockProvider)

			// unregisterWebviewProvider is now a no-op, just ensure it doesn't throw
			expect(() => {
				host.unregisterWebviewProvider("test-view")
			}).not.toThrow()
		})

		it("should handle unregistering non-existent provider gracefully", () => {
			const host = createTestHost()

			expect(() => {
				host.unregisterWebviewProvider("non-existent")
			}).not.toThrow()
		})
	})

	describe("webview ready state", () => {
		describe("isInInitialSetup", () => {
			it("should return true before webview is ready", () => {
				const host = createTestHost()
				expect(host.isInInitialSetup()).toBe(true)
			})

			it("should return false after markWebviewReady is called", () => {
				const host = createTestHost()
				host.markWebviewReady()
				expect(host.isInInitialSetup()).toBe(false)
			})
		})

		describe("markWebviewReady", () => {
			it("should set isReady to true", () => {
				const host = createTestHost()
				host.markWebviewReady()
				expect(getPrivate(host, "isReady")).toBe(true)
			})

			it("should send webviewDidLaunch message", () => {
				const host = createTestHost()
				const emitSpy = vi.spyOn(host, "emit")

				host.markWebviewReady()

				expect(emitSpy).toHaveBeenCalledWith("webviewMessage", { type: "webviewDidLaunch" })
			})

			it("should send updateSettings message", () => {
				const host = createTestHost()
				const emitSpy = vi.spyOn(host, "emit")

				host.markWebviewReady()

				// Check that updateSettings was called
				const updateSettingsCall = emitSpy.mock.calls.find(
					(call) =>
						call[0] === "webviewMessage" &&
						typeof call[1] === "object" &&
						call[1] !== null &&
						(call[1] as WebviewMessage).type === "updateSettings",
				)
				expect(updateSettingsCall).toBeDefined()
			})

			it("should force terminalShellIntegrationDisabled when terminalShell is provided", () => {
				const host = createTestHost({ terminalShell: "/bin/bash" })
				const emitSpy = vi.spyOn(host, "emit")

				host.markWebviewReady()

				const updateSettingsCall = emitSpy.mock.calls.find(
					(call) =>
						call[0] === "webviewMessage" &&
						typeof call[1] === "object" &&
						call[1] !== null &&
						(call[1] as WebviewMessage).type === "updateSettings",
				)

				expect(updateSettingsCall).toBeDefined()
				const payload = updateSettingsCall?.[1] as WebviewMessage
				expect(payload.type).toBe("updateSettings")
				expect(payload.updatedSettings?.terminalShellIntegrationDisabled).toBe(true)
			})

			// DEF-C25: the CLI must not carry its own default for the shell
			// integration timeout or sound, so the host's decided defaults
			// (30,000 ms, sound off) apply. Checkpoints stay off in the CLI on
			// purpose: that is a CLI override, not a competing default.
			it("leaves the shell integration timeout and sound to the host defaults", () => {
				const host = createTestHost()
				const emitSpy = vi.spyOn(host, "emit")

				host.markWebviewReady()

				const updateSettingsCall = emitSpy.mock.calls.find(
					(call) =>
						call[0] === "webviewMessage" &&
						typeof call[1] === "object" &&
						call[1] !== null &&
						(call[1] as WebviewMessage).type === "updateSettings",
				)
				const settings = (updateSettingsCall?.[1] as WebviewMessage).updatedSettings ?? {}

				expect(settings).not.toHaveProperty("terminalShellIntegrationTimeout")
				expect(settings).not.toHaveProperty("soundEnabled")
				expect(settings.enableCheckpoints).toBe(false)
			})
		})
	})

	describe("sendToExtension", () => {
		it("should throw error when extension not ready", () => {
			const host = createTestHost()
			const message: WebviewMessage = { type: "requestModes" }

			expect(() => {
				host.sendToExtension(message)
			}).toThrow("You cannot send messages to the extension before it is ready")
		})

		it("should emit webviewMessage event when webview is ready", () => {
			const host = createTestHost()
			const emitSpy = vi.spyOn(host, "emit")
			const message: WebviewMessage = { type: "requestModes" }

			host.markWebviewReady()
			emitSpy.mockClear() // Clear the markWebviewReady calls
			host.sendToExtension(message)

			expect(emitSpy).toHaveBeenCalledWith("webviewMessage", message)
		})

		it("should not throw when webview is ready", () => {
			const host = createTestHost()

			host.markWebviewReady()

			expect(() => {
				host.sendToExtension({ type: "requestModes" })
			}).not.toThrow()
		})
	})

	describe("message handling via client", () => {
		it("should forward extension messages to the client", () => {
			const host = createTestHost()
			const client = getPrivate(host, "client") as ExtensionClient

			// Simulate extension message.
			host.emit("extensionWebviewMessage", {
				type: "state",
				state: { clineMessages: [] },
			} as unknown as ExtensionMessage)

			// Message listener is set up in activate(), which we can't easily call in unit tests.
			// But we can verify the client exists and has the handleMessage method.
			expect(typeof client.handleMessage).toBe("function")
		})

		// The extension can post while it activates, before activate() adds the
		// client's own listener; the TUI used to listen from before activate and
		// saw those messages, so the transcript reader has to as well.
		it("feeds the transcript reader from construction on, before activate", () => {
			const host = createTestHost()
			const applied: string[] = []

			host.client.transcript.attach({
				view: () => ({ messages: [], isLoading: false, isResumingTask: false, currentTodos: [] }),
				nonInteractive: () => false,
				apply: (effects) => applied.push(...effects.map((effect) => effect.type)),
			})

			host.emit("extensionWebviewMessage", { type: "state", state: { mode: "architect" } } as ExtensionMessage)

			expect(applied).toEqual(["setCurrentMode"])
		})
	})

	describe("MCP failure notice (print mode)", () => {
		const failed = {
			name: "broken",
			config: "{}",
			status: "disconnected",
			source: "project",
			error: "spawn x ENOENT",
		}

		it("prints a failed server once on stderr", () => {
			const host = createTestHost()
			const outputError = vi.spyOn(getPrivate<{ outputError: () => void }>(host, "outputManager"), "outputError")

			callPrivate(host, "reportMcpFailures", { type: "mcpServers", mcpServers: [failed] })
			callPrivate(host, "reportMcpFailures", { type: "state", state: { mcpServers: [failed] } })

			expect(outputError).toHaveBeenCalledTimes(1)
			expect(outputError).toHaveBeenCalledWith(
				"[mcp]",
				'server "broken" (project) failed to start: spawn x ENOENT',
			)
		})

		it("ignores messages without a server list and servers that are fine", () => {
			const host = createTestHost()
			const outputError = vi.spyOn(getPrivate<{ outputError: () => void }>(host, "outputManager"), "outputError")

			callPrivate(host, "reportMcpFailures", { type: "state", state: { storageErrorMessage: "x" } })
			callPrivate(host, "reportMcpFailures", {
				type: "mcpServers",
				mcpServers: [
					{ ...failed, status: "connected" },
					{ ...failed, name: "off", disabled: true },
				],
			})

			expect(outputError).not.toHaveBeenCalled()
		})
	})

	describe("quiet mode", () => {
		describe("setupQuietMode", () => {
			it("should not modify console when integrationTest is true", () => {
				// By default, constructor sets integrationTest = true
				const host = createTestHost()
				const originalLog = console.log

				callPrivate(host, "setupQuietMode")

				// Console should not be modified since integrationTest is true
				expect(console.log).toBe(originalLog)
			})

			it("should suppress console when integrationTest is false", () => {
				// Capture the real console.log before any host is created
				const originalLog = console.log

				// Create host with integrationTest: true to prevent constructor from suppressing
				const host = createTestHost({ integrationTest: true })

				// Override integrationTest to false to test suppression
				const options = getPrivate<ExtensionHostOptions>(host, "options")
				options.integrationTest = false

				callPrivate(host, "setupQuietMode")

				// Console should be modified (suppressed)
				expect(console.log).not.toBe(originalLog)

				// Restore for other tests
				callPrivate(host, "restoreConsole")
			})

			it("should redirect console.error away from the terminal when suppressing", () => {
				// Capture the real console.error before any suppression
				const originalError = console.error

				// Create host with integrationTest: true to prevent constructor from suppressing
				const host = createTestHost({ integrationTest: true })

				// Override integrationTest to false
				const options = getPrivate<ExtensionHostOptions>(host, "options")
				options.integrationTest = false

				callPrivate(host, "setupQuietMode")

				// Raw stacks printed via console.error corrupt the TUI
				// transcript — they must go to the file debug log instead.
				expect(console.error).not.toBe(originalError)
				// The redirect must not throw, including on Error arguments.
				expect(() => console.error("API error:", new Error("boom"))).not.toThrow()

				callPrivate(host, "restoreConsole")
				expect(console.error).toBe(originalError)
			})
		})

		describe("restoreConsole", () => {
			it("should restore original console methods when suppressed", () => {
				// Capture the real console.log before any host is created
				const originalLog = console.log

				// Create host with integrationTest: true to prevent constructor from suppressing
				const host = createTestHost({ integrationTest: true })

				// Override integrationTest to false to actually suppress
				const options = getPrivate<ExtensionHostOptions>(host, "options")
				options.integrationTest = false

				callPrivate(host, "setupQuietMode")
				callPrivate(host, "restoreConsole")

				expect(console.log).toBe(originalLog)
			})

			it("should handle case where console was not suppressed", () => {
				const host = createTestHost()

				expect(() => {
					callPrivate(host, "restoreConsole")
				}).not.toThrow()
			})
		})
	})

	describe("dispose", () => {
		let host: ExtensionHost

		beforeEach(() => {
			host = createTestHost()
		})

		it("should remove message listener", async () => {
			const listener = vi.fn()
			setPrivate(host, "messageListener", listener)
			host.on("extensionWebviewMessage", listener)

			await host.dispose()

			expect(getPrivate(host, "messageListener")).toBeNull()
		})

		it("should call extension deactivate if available", async () => {
			const deactivateMock = vi.fn()
			setPrivate(host, "extensionModule", {
				deactivate: deactivateMock,
			})

			await host.dispose()

			expect(deactivateMock).toHaveBeenCalled()
		})

		it("should clear vscode reference", async () => {
			setPrivate(host, "vscode", { context: {} })

			await host.dispose()

			expect(getPrivate(host, "vscode")).toBeNull()
		})

		it("should clear extensionModule reference", async () => {
			setPrivate(host, "extensionModule", {})

			await host.dispose()

			expect(getPrivate(host, "extensionModule")).toBeNull()
		})

		it("should delete global vscode", async () => {
			;(global as Record<string, unknown>).vscode = {}

			await host.dispose()

			expect((global as Record<string, unknown>).vscode).toBeUndefined()
		})

		it("should delete global __extensionHost", async () => {
			;(global as Record<string, unknown>).__extensionHost = {}

			await host.dispose()

			expect((global as Record<string, unknown>).__extensionHost).toBeUndefined()
		})

		it("clears the global slots through the typed runtime contract", async () => {
			const globals = global as Record<string, unknown>
			globals[CLI_RUNTIME_GLOBAL_SLOTS.vscode] = {}
			globals[CLI_RUNTIME_GLOBAL_SLOTS.extensionHost] = {}

			await host.dispose()

			expect(clearCliRuntimeGlobals).toHaveBeenCalled()
			expect(globals[CLI_RUNTIME_GLOBAL_SLOTS.vscode]).toBeUndefined()
			expect(globals[CLI_RUNTIME_GLOBAL_SLOTS.extensionHost]).toBeUndefined()
		})

		it("marks the process with the contract's runtime variable", () => {
			expect(process.env[CLI_RUNTIME_ENV.runtime]).toBe("1")
		})

		it("should call restoreConsole", async () => {
			const restoreConsoleSpy = spyOnPrivate(host, "restoreConsole")

			await host.dispose()

			expect(restoreConsoleSpy).toHaveBeenCalled()
		})

		it("should clear ROO_CLI_RUNTIME on dispose when it was previously unset", async () => {
			delete process.env.ROO_CLI_RUNTIME
			host = createTestHost()
			expect(process.env.ROO_CLI_RUNTIME).toBe("1")

			await host.dispose()

			expect(process.env.ROO_CLI_RUNTIME).toBeUndefined()
		})

		it("should restore prior ROO_CLI_RUNTIME value on dispose", async () => {
			process.env.ROO_CLI_RUNTIME = "preexisting-value"
			host = createTestHost()
			expect(process.env.ROO_CLI_RUNTIME).toBe("1")

			await host.dispose()

			expect(process.env.ROO_CLI_RUNTIME).toBe("preexisting-value")
		})

		it("should restore ROO_MCP_SETTINGS_PATH on dispose", async () => {
			delete process.env.ROO_MCP_SETTINGS_PATH
			host = createTestHost({ mcpSettingsPath: "/custom/mcp.json" })
			expect(process.env.ROO_MCP_SETTINGS_PATH).toBe("/custom/mcp.json")

			await host.dispose()

			expect(process.env.ROO_MCP_SETTINGS_PATH).toBeUndefined()
		})
	})

	describe("runTask", () => {
		it("should send newTask message when called", async () => {
			const host = createTestHost()
			host.markWebviewReady()

			const emitSpy = vi.spyOn(host, "emit")
			const client = getPrivate(host, "client") as ExtensionClient

			// Start the task (will hang waiting for completion)
			const taskPromise = host.runTask("test prompt")

			// Emit completion to resolve the promise via the client's emitter
			const taskCompletedEvent = {
				success: true,
				stateInfo: {
					state: AgentLoopState.IDLE,
					isWaitingForInput: false,
					isRunning: false,
					isStreaming: false,
					requiredAction: "start_task" as const,
					description: "Task completed",
				},
			}
			setTimeout(() => client.getEmitter().emit("taskCompleted", taskCompletedEvent), 10)

			await taskPromise

			expect(emitSpy).toHaveBeenCalledWith("webviewMessage", { type: "newTask", text: "test prompt" })
		})

		it("should include taskId when provided", async () => {
			const host = createTestHost()
			host.markWebviewReady()

			const emitSpy = vi.spyOn(host, "emit")
			const client = getPrivate(host, "client") as ExtensionClient

			const taskPromise = host.runTask("test prompt", "task-123")

			const taskCompletedEvent = {
				success: true,
				stateInfo: {
					state: AgentLoopState.IDLE,
					isWaitingForInput: false,
					isRunning: false,
					isStreaming: false,
					requiredAction: "start_task" as const,
					description: "Task completed",
				},
			}
			setTimeout(() => client.getEmitter().emit("taskCompleted", taskCompletedEvent), 10)

			await taskPromise

			expect(emitSpy).toHaveBeenCalledWith("webviewMessage", {
				type: "newTask",
				text: "test prompt",
				taskId: "task-123",
			})
		})

		it("should resolve when taskCompleted is emitted on client", async () => {
			const host = createTestHost()
			host.markWebviewReady()

			const client = getPrivate(host, "client") as ExtensionClient
			const taskPromise = host.runTask("test prompt")

			// Emit completion after a short delay via the client's emitter
			const taskCompletedEvent = {
				success: true,
				stateInfo: {
					state: AgentLoopState.IDLE,
					isWaitingForInput: false,
					isRunning: false,
					isStreaming: false,
					requiredAction: "start_task" as const,
					description: "Task completed",
				},
			}
			setTimeout(() => client.getEmitter().emit("taskCompleted", taskCompletedEvent), 10)

			await expect(taskPromise).resolves.toBeUndefined()
		})

		it("should send showTaskWithId for resumeTask and resolve on completion", async () => {
			const host = createTestHost()
			host.markWebviewReady()

			const emitSpy = vi.spyOn(host, "emit")
			const client = getPrivate(host, "client") as ExtensionClient

			const taskPromise = host.resumeTask("task-abc")

			const taskCompletedEvent = {
				success: true,
				stateInfo: {
					state: AgentLoopState.IDLE,
					isWaitingForInput: false,
					isRunning: false,
					isStreaming: false,
					requiredAction: "start_task" as const,
					description: "Task completed",
				},
			}
			setTimeout(() => client.getEmitter().emit("taskCompleted", taskCompletedEvent), 10)

			await taskPromise

			expect(emitSpy).toHaveBeenCalledWith("webviewMessage", { type: "showTaskWithId", text: "task-abc" })
		})
	})

	// Print and JSON mode (not the TUI) with auto-approval on: the core asks
	// api_req_failed only for errors a retry cannot fix (401, 403, 404), and
	// nobody is there to answer. The run must fail (exit code 1 through
	// run.ts) instead of waiting forever.
	describe("api_req_failed in an unattended run", () => {
		const waitingEvent = (text: string) => ({
			ask: "api_req_failed" as const,
			stateInfo: {
				state: AgentLoopState.IDLE,
				isWaitingForInput: true,
				isRunning: false,
				isStreaming: false,
				requiredAction: "retry_or_new_task" as const,
				description: "API request failed",
			},
			message: { ts: 9, type: "ask" as const, ask: "api_req_failed" as const, text, partial: false },
		})

		it("rejects runTask with the provider's error when exitOnApiRequestFailed is set", async () => {
			const host = createTestHost({ exitOnApiRequestFailed: true })
			host.markWebviewReady()
			const client = getPrivate(host, "client") as ExtensionClient

			const taskPromise = host.runTask("test prompt")
			setTimeout(() => client.getEmitter().emit("waitingForInput", waitingEvent("401 Incorrect API key")), 10)

			await expect(taskPromise).rejects.toThrow("API request failed: 401 Incorrect API key")
		}, 5000)

		it("keeps waiting when the option is off (the TUI answers the ask itself)", async () => {
			const host = createTestHost()
			host.markWebviewReady()
			const client = getPrivate(host, "client") as ExtensionClient

			const taskPromise = host.runTask("test prompt")
			setTimeout(() => client.getEmitter().emit("waitingForInput", waitingEvent("401 Incorrect API key")), 10)
			setTimeout(
				() =>
					client.getEmitter().emit("taskCompleted", {
						success: true,
						stateInfo: {
							state: AgentLoopState.IDLE,
							isWaitingForInput: false,
							isRunning: false,
							isStreaming: false,
							requiredAction: "start_task" as const,
							description: "Task completed",
						},
					}),
				30,
			)

			await expect(taskPromise).resolves.toBeUndefined()
		})
	})

	// --exit-on-error reads the client's delivery stream (D11 step 3): a
	// retry backoff fails the run even when another message arrives in the
	// same push, and an old backoff in a resumed task's history does not.
	describe("--exit-on-error on api_req_retry_delayed", () => {
		const push = (...messages: object[]) =>
			({ type: "state", state: { clineMessages: messages } }) as unknown as ExtensionMessage
		const retry = (ts: number) => ({
			ts,
			type: "say",
			say: "api_req_retry_delayed",
			text: "429 Too Many Requests\nRetrying in 5 seconds",
		})
		const text = (ts: number, value: string) => ({ ts, type: "say", say: "text", text: value })

		it("rejects on a backoff that is not the last message of its push", async () => {
			const host = createTestHost({ exitOnError: true })
			host.markWebviewReady()

			const taskPromise = host.runTask("test prompt")
			host.client.handleMessage(push(text(1, "test prompt"), retry(2), text(3, "later")))

			await expect(taskPromise).rejects.toThrow("429 Too Many Requests")
		}, 5000)

		it("ignores a backoff in a resumed task's history", async () => {
			const host = createTestHost({ exitOnError: true })
			host.markWebviewReady()

			const taskPromise = host.resumeTask("task-abc")
			host.client.handleMessage(push(text(1, "old prompt"), retry(2)))
			host.client.handleMessage(
				push(text(1, "old prompt"), retry(2), { ts: 3, type: "ask", ask: "resume_task", partial: false }),
			)
			host.client.getEmitter().emit("taskCompleted", {
				success: true,
				stateInfo: {
					state: AgentLoopState.IDLE,
					isWaitingForInput: false,
					isRunning: false,
					isStreaming: false,
					requiredAction: "start_task" as const,
					description: "Task completed",
				},
			})

			await expect(taskPromise).resolves.toBeUndefined()
		})
	})

	describe("initial settings", () => {
		it("should set mode from options", () => {
			const host = createTestHost({ mode: "architect" })

			const initialSettings = getPrivate<Record<string, unknown>>(host, "initialSettings")
			expect(initialSettings.mode).toBe("architect")
		})

		it("should use default consecutiveMistakeLimit when not provided", () => {
			const host = createTestHost()

			const initialSettings = getPrivate<Record<string, unknown>>(host, "initialSettings")
			expect(initialSettings.consecutiveMistakeLimit).toBe(DEFAULT_FLAGS.consecutiveMistakeLimit)
		})

		it("should set consecutiveMistakeLimit from options", () => {
			const host = createTestHost({ consecutiveMistakeLimit: 8 })

			const initialSettings = getPrivate<Record<string, unknown>>(host, "initialSettings")
			expect(initialSettings.consecutiveMistakeLimit).toBe(8)
		})

		it("should use the default commandExecutionTimeout when not provided", () => {
			const host = createTestHost()

			const initialSettings = getPrivate<Record<string, unknown>>(host, "initialSettings")
			expect(initialSettings.commandExecutionTimeout).toBe(DEFAULT_FLAGS.commandExecutionTimeout)
		})

		it("should set commandExecutionTimeout from options, including 0 for no limit", () => {
			const longHost = createTestHost({ commandExecutionTimeout: 1800 })
			const unlimitedHost = createTestHost({ commandExecutionTimeout: 0 })

			expect(getPrivate<Record<string, unknown>>(longHost, "initialSettings").commandExecutionTimeout).toBe(1800)
			expect(getPrivate<Record<string, unknown>>(unlimitedHost, "initialSettings").commandExecutionTimeout).toBe(
				0,
			)
		})

		it("should enable auto-approval in non-interactive mode", () => {
			const host = createTestHost({ nonInteractive: true })

			const initialSettings = getPrivate<Record<string, unknown>>(host, "initialSettings")
			expect(initialSettings).toMatchObject(getPermissionSettings("allow"))
		})

		it("should disable auto-approval in interactive mode", () => {
			const host = createTestHost({ nonInteractive: false })

			const initialSettings = getPrivate<Record<string, unknown>>(host, "initialSettings")
			expect(initialSettings).toMatchObject(getPermissionSettings("ask"))
		})

		it("should set reasoning effort when specified", () => {
			const host = createTestHost({ reasoningEffort: "high" })

			const initialSettings = getPrivate<Record<string, unknown>>(host, "initialSettings")
			expect(initialSettings.enableReasoningEffort).toBe(true)
			expect(initialSettings.reasoningEffort).toBe("high")
		})

		it("should disable reasoning effort when set to disabled", () => {
			const host = createTestHost({ reasoningEffort: "disabled" })

			const initialSettings = getPrivate<Record<string, unknown>>(host, "initialSettings")
			expect(initialSettings.enableReasoningEffort).toBe(false)
		})

		it("should not set reasoning effort when unspecified", () => {
			const host = createTestHost({ reasoningEffort: "unspecified" })

			const initialSettings = getPrivate<Record<string, unknown>>(host, "initialSettings")
			expect(initialSettings.enableReasoningEffort).toBeUndefined()
			expect(initialSettings.reasoningEffort).toBeUndefined()
		})
	})

	describe("ephemeral mode", () => {
		it("should store ephemeral option correctly", () => {
			const host = createTestHost({ ephemeral: true })

			const options = getPrivate<ExtensionHostOptions>(host, "options")
			expect(options.ephemeral).toBe(true)
		})

		it("should default ephemeralStorageDir to null", () => {
			const host = createTestHost()

			expect(getPrivate(host, "ephemeralStorageDir")).toBeNull()
		})

		it("should clean up ephemeral storage directory on dispose", async () => {
			const host = createTestHost({ ephemeral: true })

			// Set up a mock ephemeral storage directory
			const mockEphemeralDir = "/tmp/roo-cli-test-ephemeral-cleanup"
			setPrivate(host, "ephemeralStorageDir", mockEphemeralDir)

			// Mock fs.promises.rm
			const rmMock = vi.spyOn(fs.promises, "rm").mockResolvedValue(undefined)

			await host.dispose()

			expect(rmMock).toHaveBeenCalledWith(mockEphemeralDir, { recursive: true, force: true })
			expect(getPrivate(host, "ephemeralStorageDir")).toBeNull()

			rmMock.mockRestore()
		})

		it("should not clean up when ephemeralStorageDir is null", async () => {
			const host = createTestHost()

			// ephemeralStorageDir is null by default
			expect(getPrivate(host, "ephemeralStorageDir")).toBeNull()

			const rmMock = vi.spyOn(fs.promises, "rm").mockResolvedValue(undefined)

			await host.dispose()

			// rm should not be called when there's no ephemeral storage
			expect(rmMock).not.toHaveBeenCalled()

			rmMock.mockRestore()
		})

		it("should handle ephemeral storage cleanup errors gracefully", async () => {
			const host = createTestHost({ ephemeral: true })

			// Set up a mock ephemeral storage directory
			setPrivate(host, "ephemeralStorageDir", "/tmp/roo-cli-test-ephemeral-error")

			// Mock fs.promises.rm to throw an error
			const rmMock = vi.spyOn(fs.promises, "rm").mockRejectedValue(new Error("Cleanup failed"))

			// dispose should not throw even if cleanup fails
			await expect(host.dispose()).resolves.toBeUndefined()

			rmMock.mockRestore()
		})

		it("should not affect normal mode when ephemeral is false", () => {
			const host = createTestHost({ ephemeral: false })

			const options = getPrivate<ExtensionHostOptions>(host, "options")
			expect(options.ephemeral).toBe(false)
			expect(getPrivate(host, "ephemeralStorageDir")).toBeNull()
		})
	})
})
