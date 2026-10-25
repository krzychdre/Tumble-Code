// cd src && npx vitest run core/prompts/__tests__/compact-off-golden.spec.ts
//
// GOLDEN GUARD for the compact profile (ai_plans/2026-10-10_19-36_compact-small-model-profile.md).
//
// Invariant: with the `compactProfile` flag absent or false, everything the model
// sees is byte-identical to the code before the compact profile landed. This file
// pins those bytes on the LIVE request path, for every built-in mode and for the
// two profile shapes users run today (a plain profile and a slim one):
//
//   (a) the full system prompt, built by ApiRequestBuilder.buildSystemPrompt;
//   (b) the native tools array, built by ApiRequestBuilder.buildToolsArray (the
//       call TaskApiLoop.attemptApiRequest makes, which wraps
//       buildNativeToolsArrayWithRestrictions);
//   (c) for code and ask mode, the tools array and the other request parameters
//       as the OpenAI-compatible handler hands them to the SDK, after
//       convertToolsForOpenAI.
//
// The snapshots were generated on the unmodified code. Later commits must pass
// this file WITHOUT `-u`. A diff here means the compact work leaked into the
// off path; fix the code, not the snapshot.
//
// Only the machine-dependent inputs are stubbed (os, shell, the settings
// directory, the memory directory, the code index), and each stub sits as low
// as possible, so the real modes, memory, skills and MCP sections are rendered
// and pinned. The memory index fixture is longer than the 3,000-character cap the
// compact profile introduces, so a cap leaking into the off path shows up here.

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
// The memory paths are built with path.join: give them as on Linux on every
// platform, like the os stub above, so the pinned bytes match on a Windows runner.
vi.mock("path", async (importOriginal) => {
	const actual = await importOriginal<typeof import("path")>()
	return { ...actual.posix, default: actual.posix }
})

const { MEMORY_ROOT, MEMORY_INDEX_FIXTURE } = vi.hoisted(() => {
	// 40 index lines of about 100 characters: about 4,000 characters, above the
	// compact cap (3,000) and well below the normal cap (25,000 bytes, 200 lines).
	const lines: string[] = []
	for (let i = 1; i <= 40; i++) {
		const n = String(i).padStart(2, "0")
		lines.push(
			`- [Golden note ${n}](note_${n}.md) - a fixed memory entry that keeps the index above the compact cap`,
		)
	}
	return {
		MEMORY_ROOT: "/mock/settings/path/memory/",
		MEMORY_INDEX_FIXTURE: `# Memory Index\n\n${lines.join("\n")}\n`,
	}
})

// The memory directory lives under the extension's global storage. Reads and
// mkdirs below that root are answered here; every other path goes to the real
// filesystem (the workspace /test/path does not exist, so rule files are absent).
vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	const isMemoryPath = (p: unknown) => String(p).startsWith(MEMORY_ROOT)
	const readFile = (async (p: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
		if (isMemoryPath(p)) {
			if (String(p).endsWith("MEMORY.md")) {
				return MEMORY_INDEX_FIXTURE
			}
			throw Object.assign(new Error(`ENOENT: ${String(p)}`), { code: "ENOENT" })
		}
		return (actual.readFile as (...args: unknown[]) => unknown)(p, ...rest)
	}) as typeof actual.readFile
	const mkdir = (async (p: Parameters<typeof actual.mkdir>[0], ...rest: unknown[]) => {
		if (isMemoryPath(p)) {
			return undefined
		}
		return (actual.mkdir as (...args: unknown[]) => unknown)(p, ...rest)
	}) as typeof actual.mkdir
	const mocked = { ...actual, readFile, mkdir }
	return { ...mocked, default: mocked }
})

// The modes section creates the settings directory before listing the modes;
// the listing itself (built-in modes, no overrides) is real.
vi.mock("../../../utils/globalContext", () => ({
	ensureSettingsDirectoryExists: vi.fn(async () => "/mock/settings/path/settings"),
}))

vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: {
		getInstance: vi.fn(() => ({ isFeatureEnabled: true, isFeatureConfigured: true, isInitialized: true })),
	},
}))

const { hub } = vi.hoisted(() => ({
	/** One server with a tool and a resource, so every MCP prompt path and schema has something to say. */
	hub: {
		getServers: () => [
			{
				name: "docs-server",
				disabled: false,
				resources: [{ uri: "docs://index", name: "Docs index" }],
				tools: [
					{
						name: "lookup",
						description: "Look a symbol up.",
						inputSchema: {
							type: "object",
							properties: {
								symbol: { type: "string", description: "The symbol name." },
								limit: { type: "number", description: "Maximum number of hits." },
							},
							required: ["symbol"],
						},
					},
				],
			},
		],
		isConnecting: false,
	},
}))

// The live path asks the singleton manager for the hub; the provider holds the same singleton.
vi.mock("../../../services/mcp/McpServerManager", () => ({
	McpServerManager: { getInstance: vi.fn(async () => hub) },
}))

// The OpenAI SDK client: records the request and answers with a tiny stream.
const { create } = vi.hoisted(() => ({
	create: vi.fn(async (_params: unknown, _options?: unknown) =>
		(async function* () {
			yield { choices: [{ delta: { content: "ok" }, index: 0 }] }
			yield { choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }
		})(),
	),
}))
vi.mock("openai", () => {
	const client = vi.fn(function () {
		return { chat: { completions: { create } } }
	})
	return { __esModule: true, default: client, OpenAI: client, AzureOpenAI: client }
})

import type * as vscode from "vscode"

import { type ProviderSettings, experimentDefault } from "@tumble-code/types"

import { OpenAiHandler } from "../../../api/providers/openai"
import { initMemoryPaths, resetMemoryPaths } from "../../memory/paths"
import { modes } from "../../../shared/modes"
import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../../task/ApiRequestBuilder"
import type { ProviderState } from "../../webview/ProviderStateBuilder"

const CWD = "/test/path"
const SNAPSHOT_DIR = "./__snapshots__/compact-off-golden"

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

/** One skill available in every mode, so the AVAILABLE SKILLS section is pinned too. */
const skillsManager = {
	getSkillsForMode: () => [
		{
			name: "release-notes",
			description: "Write release notes from the git log.",
			path: "/home/user/.roo/skills/release-notes/SKILL.md",
			source: "global" as const,
		},
	],
}

/**
 * The OpenAI-compatible profile of a local llama.cpp server, the setup the
 * compact profile is for. The shapes below are spread over it.
 */
const BASE_PROFILE: ProviderSettings = {
	apiProvider: "openai",
	openAiBaseUrl: "http://127.0.0.1:8080/v1",
	openAiApiKey: "not-needed",
	openAiModelId: "qwen3.5-4b-q4_k_m",
}

interface ProfileCase {
	/** How the case is named in the test output. */
	label: string
	/** Which pinned snapshot set the case must reproduce. */
	snapshot: "default" | "slim"
	/** Spread over BASE_PROFILE. */
	shape: Partial<ProviderSettings>
}

/**
 * The profile shapes users run today, each owning one snapshot set, followed by
 * the same shapes with the compact flag saved as false. Those reuse the SAME
 * snapshot files on purpose: an explicit false must produce exactly the bytes of
 * an absent flag, so they never get snapshots of their own.
 */
const PROFILE_CASES: ProfileCase[] = [
	{ label: "{}", snapshot: "default", shape: {} },
	{ label: "{ slimToolset: true }", snapshot: "slim", shape: { slimToolset: true } },
	{ label: "{ compactProfile: false }", snapshot: "default", shape: { compactProfile: false } },
	{
		label: "{ slimToolset: true, compactProfile: false }",
		snapshot: "slim",
		shape: { slimToolset: true, compactProfile: false },
	},
]

const BUILT_IN_MODES = modes.map((mode) => mode.slug)

/** Provider state as `getState()` returns it, with the profile as the active one. */
function makeState(profile: ProviderSettings): ProviderState {
	return {
		mode: "code",
		mcpEnabled: true,
		customModes: [],
		customModePrompts: {},
		experiments: { ...experimentDefault },
		language: "en",
		enableSubfolderRules: false,
		webToolsEnabled: false,
		apiConfiguration: profile,
	} as unknown as ProviderState
}

/**
 * The live request pieces for one profile and mode: a Task-shaped access object
 * (Task hands itself to ApiRequestBuilder) whose own profile and handler are
 * built from the profile, exactly as `new Task({ apiConfiguration })` does.
 */
function makeRequest(shape: Partial<ProviderSettings>, mode: string) {
	const profile: ProviderSettings = { ...BASE_PROFILE, ...shape }
	const state = makeState(profile)
	const api = new OpenAiHandler(profile)
	const provider = {
		context: mockContext,
		cwd: CWD,
		getState: vi.fn().mockResolvedValue(state),
		getMcpHub: vi.fn().mockReturnValue(hub),
		getSkillsManager: vi.fn().mockReturnValue(skillsManager),
	}
	const task = {
		taskId: "task-golden",
		instanceId: "instance-golden",
		isBackground: false,
		apiConfiguration: profile,
		api,
		apiConversationHistory: [],
		microcompactedIds: new Set<string>(),
		providerRef: { deref: () => provider },
		cwd: CWD,
		contextManager: {},
		rooIgnoreController: undefined,
		getTokenUsage: () => ({}),
		getTaskMode: vi.fn().mockResolvedValue(mode),
		emit: vi.fn(),
		materializedDeferredTools: new Set<string>(),
		deferredToolDirectory: new Map(),
	}
	const builder = new ApiRequestBuilder(task as unknown as ApiRequestBuilderAccess)
	return { profile, state, api, builder }
}

async function buildLiveSystemPrompt(shape: Partial<ProviderSettings>, mode: string): Promise<string> {
	const { builder, state } = makeRequest(shape, mode)
	return builder.buildSystemPrompt(state)
}

async function buildLiveTools(shape: Partial<ProviderSettings>, mode: string) {
	const { builder, state, api } = makeRequest(shape, mode)
	// TaskApiLoop.attemptApiRequest passes the state's apiConfiguration and the task's model info.
	return builder.buildToolsArray(state, state.apiConfiguration, mode, api.getModel().info)
}

/** What the OpenAI-compatible handler sends to the SDK for one request with these tools. */
async function sendThroughOpenAiHandler(shape: Partial<ProviderSettings>, mode: string) {
	const { api } = makeRequest(shape, mode)
	const { allTools } = await buildLiveTools(shape, mode)

	create.mockClear()
	const stream = api.createMessage("system prompt", [{ role: "user", content: "hello" }], {
		taskId: "task-golden",
		mode,
		tools: allTools,
		tool_choice: "auto",
	})
	for await (const _chunk of stream) {
		// drain
	}

	expect(create).toHaveBeenCalledTimes(1)
	const body = JSON.parse(JSON.stringify(create.mock.calls[0][0])) as Record<string, unknown>
	const { tools, messages: _messages, ...params } = body
	return { tools, params }
}

/**
 * The pinned output contains en and em dashes (mostly in the memory prompt, which
 * was ported from Claude Code). This repository keeps those two characters out of
 * its own files, so the snapshots store them as the six-character escapes
 * `\u2013` and `\u2014` (valid JSON escapes in the .json files). The mapping
 * stays lossless because the raw output must not contain either escape spelled
 * out literally, which is asserted here.
 */
function pinnable(text: string): string {
	expect(text).not.toMatch(/\\u201[34]/)
	return text.replace(/[\u2013\u2014]/g, (dash) => `\\u${dash.charCodeAt(0).toString(16)}`)
}

function json(value: unknown): string {
	return pinnable(`${JSON.stringify(value, null, 2)}\n`)
}

beforeAll(() => {
	// Memory on, isolated layout, at a fixed path the fs stub above answers for.
	initMemoryPaths("/mock/settings/path", () => ({}))
})

afterAll(() => {
	resetMemoryPaths()
})

describe("compact profile off: golden bytes", () => {
	it("renders every section this file claims to pin (non-vacuity)", async () => {
		const prompt = await buildLiveSystemPrompt({}, "code")

		expect(prompt).toContain("====\n\nMODES")
		expect(prompt).toContain(" mode (orchestrator) - ")
		expect(prompt).toContain("====\n\nAVAILABLE SKILLS")
		expect(prompt).toContain("====\n\nMCP SERVERS")
		expect(prompt).toContain("Golden note 40")
		expect(prompt).toContain(MEMORY_ROOT)
		expect(MEMORY_INDEX_FIXTURE.length).toBeGreaterThan(3_000)

		const { allTools } = await buildLiveTools({}, "code")
		const names = allTools.map((tool) => (tool as { function: { name: string } }).function.name)
		expect(names).toContain("mcp--docs-server--lookup")
		expect(names).toContain("apply_diff")
	})

	describe.each(PROFILE_CASES)("profile $label", ({ shape, snapshot }) => {
		// The slim toolset changes nothing in the prompts of the modes without tools to slim.
		const promptModes =
			snapshot === "slim"
				? BUILT_IN_MODES.filter((mode) => !["orchestrator", "vision"].includes(mode))
				: BUILT_IN_MODES

		it.each(promptModes)("(a) system prompt, %s mode", async (mode) => {
			const prompt = await buildLiveSystemPrompt(shape, mode)

			await expect(pinnable(prompt)).toMatchFileSnapshot(`${SNAPSHOT_DIR}/system-prompt.${snapshot}.${mode}.snap`)
		})

		// debug has the same tool groups as code.
		it.each(BUILT_IN_MODES.filter((mode) => mode !== "debug"))("(b) native tools array, %s mode", async (mode) => {
			const { allTools, allowedFunctionNames } = await buildLiveTools(shape, mode)

			// The OpenAI-compatible provider has no allowedFunctionNames restriction.
			expect(allowedFunctionNames).toBeUndefined()
			await expect(json(allTools)).toMatchFileSnapshot(
				`${SNAPSHOT_DIR}/native-tools.${snapshot}.${mode}.json.snap`,
			)
		})

		it.each(["code", "ask"])("(c) tools and parameters after OpenAI conversion, %s mode", async (mode) => {
			const { tools, params } = await sendThroughOpenAiHandler(shape, mode)

			await expect(json(tools)).toMatchFileSnapshot(`${SNAPSHOT_DIR}/openai-tools.${snapshot}.${mode}.json.snap`)
			// The same parameters for every mode and profile.
			await expect(json(params)).toMatchFileSnapshot(`${SNAPSHOT_DIR}/openai-params.json.snap`)
		})
	})
})
