// cd src && npx vitest run core/prompts/__tests__/compact-tools.spec.ts
//
// The compact tool arrays on the LIVE request path
// (ai_plans/2026-10-10_19-36_compact-small-model-profile.md, budgets): for every
// built-in mode, the native tools array ApiRequestBuilder.buildToolsArray builds
// for a task whose own profile has `compactProfile` on, and the same array as the
// OpenAI-compatible handler hands it to the SDK. Snapshots live in
// `__snapshots__/compact-tools/`; `sizes.json.snap` records the measured sizes
// next to today's, and the budget is asserted here: at most 5,000 characters in
// code mode and 3,000 in ask mode after conversion, web tools off.
//
// Sizes are `JSON.stringify(tools).length` of the array the SDK receives.

vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: {
		getInstance: vi.fn(() => ({ isFeatureEnabled: true, isFeatureConfigured: true, isInitialized: true })),
	},
}))

const { hub } = vi.hoisted(() => ({
	/** One server with a tool and a resource: the compact arrays must carry neither. */
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
							properties: { symbol: { type: "string", description: "The symbol name." } },
							required: ["symbol"],
						},
					},
				],
			},
		],
		isConnecting: false,
	},
}))

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
import { modes } from "../../../shared/modes"
import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../../task/ApiRequestBuilder"
import type { ProviderState } from "../../webview/ProviderStateBuilder"

const CWD = "/test/path"
const SNAPSHOT_DIR = "./__snapshots__/compact-tools"

const CODE_MODE_BUDGET = 5_000
const ASK_MODE_BUDGET = 3_000

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

/** The OpenAI-compatible profile of a local llama.cpp server, as in the golden spec. */
const BASE_PROFILE: ProviderSettings = {
	apiProvider: "openai",
	openAiBaseUrl: "http://127.0.0.1:8080/v1",
	openAiApiKey: "not-needed",
	openAiModelId: "qwen3.5-4b-q4_k_m",
}

const COMPACT: Partial<ProviderSettings> = { compactProfile: true }

const BUILT_IN_MODES = modes.map((mode) => mode.slug)

function makeRequest(shape: Partial<ProviderSettings>, mode: string, webToolsEnabled = false) {
	const profile: ProviderSettings = { ...BASE_PROFILE, ...shape }
	const state = {
		mode: "code",
		mcpEnabled: true,
		customModes: [],
		customModePrompts: {},
		experiments: { ...experimentDefault },
		language: "en",
		enableSubfolderRules: false,
		webToolsEnabled,
		apiConfiguration: profile,
	} as unknown as ProviderState
	const api = new OpenAiHandler(profile)
	const provider = {
		context: mockContext,
		cwd: CWD,
		getState: vi.fn().mockResolvedValue(state),
		getMcpHub: vi.fn().mockReturnValue(hub),
	}
	const task = {
		taskId: "task-compact",
		instanceId: "instance-compact",
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
	return { state, api, builder: new ApiRequestBuilder(task as unknown as ApiRequestBuilderAccess) }
}

/** The native tools array of one request, and the same array after the OpenAI-compatible handler. */
async function buildTools(shape: Partial<ProviderSettings>, mode: string, webToolsEnabled = false) {
	const { builder, state, api } = makeRequest(shape, mode, webToolsEnabled)
	const { allTools } = await builder.buildToolsArray(state, state.apiConfiguration, mode, api.getModel().info)

	create.mockClear()
	const stream = api.createMessage("system prompt", [{ role: "user", content: "hello" }], {
		taskId: "task-compact",
		mode,
		tools: allTools,
		tool_choice: "auto",
	})
	for await (const _chunk of stream) {
		// drain
	}
	expect(create).toHaveBeenCalledTimes(1)
	const sent = (create.mock.calls[0][0] as { tools: unknown[] }).tools

	return { native: allTools, sent }
}

function toolNames(tools: unknown[]): string[] {
	return tools.map((tool) => (tool as { function: { name: string } }).function.name)
}

function json(value: unknown): string {
	const text = `${JSON.stringify(value, null, 2)}\n`
	// The repository keeps en and em dashes out of its files.
	expect(text).not.toMatch(/[\u2013\u2014]/)
	return text
}

// debug has the same tool groups as code.
const TOOL_MODES = BUILT_IN_MODES.filter((mode) => mode !== "debug")

describe("compact profile: tool arrays on the live path", () => {
	it.each(TOOL_MODES)("native tools array, %s mode", async (mode) => {
		const { native } = await buildTools(COMPACT, mode)

		await expect(json(native)).toMatchFileSnapshot(`${SNAPSHOT_DIR}/native-tools.${mode}.json.snap`)
	})

	it.each(TOOL_MODES)("tools after OpenAI conversion, %s mode", async (mode) => {
		const { sent } = await buildTools(COMPACT, mode)

		await expect(json(sent)).toMatchFileSnapshot(`${SNAPSHOT_DIR}/openai-tools.${mode}.json.snap`)
	})

	it("records the sizes per mode next to today's", async () => {
		const sizes: Record<string, unknown> = {}
		for (const mode of BUILT_IN_MODES) {
			const today = await buildTools({}, mode)
			const compact = await buildTools(COMPACT, mode)
			const compactWeb = await buildTools(COMPACT, mode, true)
			sizes[mode] = {
				todayTools: today.sent.length,
				todayNativeChars: JSON.stringify(today.native).length,
				todaySentChars: JSON.stringify(today.sent).length,
				compactTools: compact.sent.length,
				compactNativeChars: JSON.stringify(compact.native).length,
				compactSentChars: JSON.stringify(compact.sent).length,
				compactWithWebToolsSentChars: JSON.stringify(compactWeb.sent).length,
			}
		}

		await expect(json(sizes)).toMatchFileSnapshot(`${SNAPSHOT_DIR}/sizes.json.snap`)
	})

	it("stays within the budget: code mode 5,000 and ask mode 3,000 characters as sent", async () => {
		const code = await buildTools(COMPACT, "code")
		const ask = await buildTools(COMPACT, "ask")

		expect(JSON.stringify(code.sent).length).toBeLessThanOrEqual(CODE_MODE_BUDGET)
		expect(JSON.stringify(ask.sent).length).toBeLessThanOrEqual(ASK_MODE_BUDGET)
	})

	it("offers the compact set: edit instead of apply_diff, no MCP, no edit tool in ask mode", async () => {
		const code = toolNames((await buildTools(COMPACT, "code")).sent)
		const ask = toolNames((await buildTools(COMPACT, "ask")).sent)

		expect(code).toEqual([
			"read_file",
			"list_files",
			"search_files",
			"ask_followup_question",
			"attempt_completion",
			"switch_mode",
			"edit",
			"write_to_file",
			"execute_command",
		])
		expect(ask).toEqual(code.slice(0, 6))
	})

	it("keeps optional parameters optional after the OpenAI conversion", async () => {
		const { sent } = await buildTools(COMPACT, "code")
		const byName = new Map(sent.map((tool) => [(tool as { function: { name: string } }).function.name, tool]))
		const fn = (name: string) =>
			(byName.get(name) as { function: { strict: boolean; parameters: { required: string[] } } }).function

		expect(fn("read_file").strict).toBe(false)
		expect(fn("read_file").parameters.required).toEqual(["path"])
		expect(fn("edit").parameters.required).toEqual(["file_path", "old_string", "new_string"])
		expect(fn("execute_command").parameters.required).toEqual(["command"])
		expect(fn("list_files").parameters.required).toEqual(["path"])
	})

	it.each(["code", "ask"])("supersedes slim: compact plus slim sends the same %s array", async (mode) => {
		const compact = await buildTools(COMPACT, mode)
		const both = await buildTools({ ...COMPACT, slimToolset: true, slimHidesMcp: false }, mode)

		expect(JSON.stringify(both.sent)).toBe(JSON.stringify(compact.sent))
	})
})
