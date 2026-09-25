// cd src && ./node_modules/.bin/vitest run core/prompts/__tests__/system-prompt-parity.spec.ts
//
// CORE-R11: the "copy system prompt" preview (generateSystemPrompt) and the
// live request path (ApiRequestBuilder.buildSystemPrompt) must build the SAME
// system prompt for the same task state. They used to assemble the prompt
// inputs separately and drifted: DEF-C1 (the live path lost the .rooignore
// section) was one such drift, and this file pins the rest.
//
// The prompt is built by the REAL assembly (only the machine-dependent
// sections are stubbed, as in prefix-stability.spec.ts), so these tests compare
// bytes, not mock calls. A snapshot of the live bytes guards the prompt-cache
// prefix: the refactor must not change a single byte the live path sends.

vi.mock("os", () => {
	const os = {
		homedir: () => "/home/user",
		platform: () => "linux",
		arch: () => "x64",
		type: () => "Linux",
		release: () => "5.4.0",
		hostname: () => "test-host",
		tmpdir: () => "/tmp",
		endianness: () => "LE",
		loadavg: () => [0, 0, 0],
		totalmem: () => 8589934592,
		freemem: () => 4294967296,
		cpus: () => [],
		networkInterfaces: () => ({}),
		userInfo: () => ({ username: "test", uid: 1000, gid: 1000, shell: "/bin/bash", homedir: "/home/user" }),
	}
	return { default: os, ...os }
})

vi.mock("default-shell", () => ({ default: "/bin/zsh" }))
vi.mock("os-name", () => ({ default: () => "Linux" }))
vi.mock("../../../utils/shell", () => ({ getShell: () => "/bin/zsh" }))

// The modes list and the memory sections read the tester's disk; fixed bodies
// keep the snapshot reproducible on any machine.
vi.mock("../sections/modes", () => ({
	getModesSection: vi.fn().mockImplementation(async () => "====\n\nMODES\n\n- Test modes section"),
}))
vi.mock("../sections/memory", () => ({
	getMemorySection: vi.fn().mockResolvedValue("# auto memory\n\nMemory behavioral body."),
	getMemoryIndexSection: vi.fn().mockResolvedValue("Contents of MEMORY.md:\n\n- [Entry](file.md)"),
}))
vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: {
		getInstance: vi.fn(() => ({ isFeatureEnabled: true, isFeatureConfigured: true, isInitialized: true })),
	},
}))

const { hub } = vi.hoisted(() => ({
	/** Two servers with one tool each, so the MCP and deferred-tools sections have something to say. */
	hub: {
		getServers: () => [
			{
				name: "docs-server",
				disabled: false,
				resources: [{ uri: "docs://index", name: "Docs index" }],
				tools: [{ name: "lookup", description: "Look a symbol up.", inputSchema: { type: "object" } }],
			},
			{
				name: "build-server",
				disabled: false,
				resources: [],
				tools: [{ name: "compile", description: "Compile the project.", inputSchema: { type: "object" } }],
			},
		],
		isConnecting: false,
	},
}))

// The live path asks the singleton manager for the hub; the provider holds the same singleton.
vi.mock("../../../services/mcp/McpServerManager", () => ({
	McpServerManager: { getInstance: vi.fn(async () => hub) },
}))

// The preview builds a throwaway handler from the profile only to read `isStealthModel`.
vi.mock("../../../api", () => ({
	buildApiHandler: () => ({ getModel: () => ({ id: "test-model", info: { isStealthModel: false } }) }),
}))

// Spy on SYSTEM_PROMPT while keeping the real assembly behind it.
vi.mock("../system", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../system")>()
	return { ...actual, SYSTEM_PROMPT: vi.fn(actual.SYSTEM_PROMPT) }
})

import { createHash } from "crypto"
import type * as vscode from "vscode"

import { SYSTEM_PROMPT } from "../system"
import { getMcpServerTools } from "../tools/native-tools"
import type { McpHub } from "../../../services/mcp/McpHub"
import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../../task/ApiRequestBuilder"
import { MultiSearchReplaceDiffStrategy } from "../../diff/strategies/multi-search-replace"
import { generateSystemPrompt } from "../../webview/generateSystemPrompt"
import type { ClineProvider } from "../../webview/ClineProvider"

const CWD = "/test/path"
const ROOIGNORE_INSTRUCTIONS = "# .rooignore\n\nsecrets/\n*.env"

const mockContext = {
	extensionPath: "/mock/extension/path",
	globalStoragePath: "/mock/storage/path",
	subscriptions: [],
	workspaceState: { get: () => undefined, update: () => Promise.resolve() },
	globalState: { get: () => undefined, update: () => Promise.resolve(), setKeysForSync: () => {} },
	extensionUri: { fsPath: "/mock/extension/path" },
	globalStorageUri: { fsPath: "/mock/settings/path" },
	asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
	extension: { packageJSON: { version: "1.0.0" } },
} as unknown as vscode.ExtensionContext

/** Provider state as `getState()` returns it (every setting resolved). */
function makeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		mode: "code",
		mcpEnabled: true,
		customModes: [],
		customModePrompts: {},
		customInstructions: "Prefer small commits.",
		experiments: {},
		language: "en",
		enableSubfolderRules: false,
		apiConfiguration: { apiProvider: "openai", todoListEnabled: true },
		...overrides,
	}
}

function makeProvider(state: Record<string, unknown>) {
	return {
		context: mockContext,
		cwd: CWD,
		getState: vi.fn().mockResolvedValue(state),
		getMcpHub: vi.fn().mockReturnValue(hub),
		getSkillsManager: vi.fn().mockReturnValue(undefined),
		customModesManager: { getCustomModes: vi.fn().mockResolvedValue(state.customModes ?? []) },
		getCurrentTask: vi.fn(),
	}
}

/** The task as the live path sees it (Task hands itself to ApiRequestBuilder as the access object). */
function makeTask(provider: ReturnType<typeof makeProvider>, materialized: string[] = []) {
	return {
		taskId: "task-1",
		instanceId: "instance-1",
		isBackground: false,
		apiConfiguration: {},
		api: { getModel: () => ({ id: "test-model", info: { isStealthModel: false } }) },
		apiConversationHistory: [],
		microcompactedToolUseIds: new Set<string>(),
		providerRef: { deref: () => provider },
		cwd: CWD,
		// Task sets exactly this in its constructor.
		diffStrategy: new MultiSearchReplaceDiffStrategy(),
		contextManager: {},
		rooIgnoreController: { getInstructions: () => ROOIGNORE_INSTRUCTIONS },
		getTokenUsage: () => ({}),
		getTaskMode: vi.fn().mockResolvedValue("code"),
		emit: vi.fn(),
		materializedDeferredTools: new Set<string>(materialized),
		deferredToolDirectory: new Map(),
	}
}

/** Build the preview and the live prompt for one task state, recording what each passed to SYSTEM_PROMPT. */
async function previewAndLive(state: Record<string, unknown>, materialized: string[] = []) {
	const provider = makeProvider(state)
	const task = makeTask(provider, materialized)
	provider.getCurrentTask.mockReturnValue(task)

	vi.mocked(SYSTEM_PROMPT).mockClear()
	const preview = await generateSystemPrompt(provider as unknown as ClineProvider, {
		type: "getSystemPrompt",
		mode: "code",
	})
	const live = await new ApiRequestBuilder(task as unknown as ApiRequestBuilderAccess).buildSystemPrompt()
	const [previewInput, liveInput] = vi.mocked(SYSTEM_PROMPT).mock.calls

	return { preview, live, previewInput, liveInput }
}

/** The MCP tool names as the deferred catalog prints them (servers sorted by name). */
function mcpToolNames(): string[] {
	return getMcpServerTools(hub as unknown as McpHub).map(
		(tool) => (tool as { function: { name: string } }).function.name,
	)
}

describe("system prompt: preview equals live (CORE-R11)", () => {
	it("builds the same bytes for a plain task", async () => {
		const { preview, live } = await previewAndLive(makeState())

		expect(live).toContain("MCP SERVERS")
		expect(live).toContain(ROOIGNORE_INSTRUCTIONS)
		expect(preview).toBe(live)
	})

	it("builds the same bytes after the task loaded a deferred tool", async () => {
		const [loaded, stillDeferred] = mcpToolNames()
		const { preview, live } = await previewAndLive(makeState({ experiments: { deferredTools: true } }), [loaded])

		// The live catalog no longer offers the tool the task already loaded.
		expect(live).toContain(stillDeferred)
		expect(live).not.toContain(loaded)
		expect(preview).toBe(live)
	})

	it("builds the same bytes when the state carries no mcpEnabled value", async () => {
		const state = makeState()
		delete state.mcpEnabled

		const { preview, live } = await previewAndLive(state)

		// Both paths fall back to the settings default (MCP on).
		expect(live).toContain("MCP SERVERS")
		expect(preview).toBe(live)
	})

	it("passes the same input to SYSTEM_PROMPT", async () => {
		const [loaded] = mcpToolNames()
		const { previewInput, liveInput } = await previewAndLive(makeState({ experiments: { deferredTools: true } }), [
			loaded,
		])

		expect(previewInput).toEqual(liveInput)
	})
})

/**
 * The live bytes as a length plus a SHA-256 digest. A full-text snapshot would
 * duplicate the whole prompt (the prefix-stability and system-prompt snapshots
 * already carry it); the digest is enough to prove the bytes did not move, and
 * the parity tests above show WHERE two prompts differ when they do.
 */
function fingerprint(prompt: string) {
	return { length: prompt.length, sha256: createHash("sha256").update(prompt).digest("hex") }
}

describe("system prompt: live bytes are pinned (CORE-R11 must not change them)", () => {
	it("plain task", async () => {
		const { live } = await previewAndLive(makeState())
		expect(fingerprint(live)).toMatchSnapshot()
	})

	it("deferred tools on, one tool loaded", async () => {
		const { live } = await previewAndLive(makeState({ experiments: { deferredTools: true } }), [mcpToolNames()[0]])
		expect(fingerprint(live)).toMatchSnapshot()
	})

	it("state without an mcpEnabled value", async () => {
		const state = makeState()
		delete state.mcpEnabled
		const { live } = await previewAndLive(state)
		expect(fingerprint(live)).toMatchSnapshot()
	})
})
