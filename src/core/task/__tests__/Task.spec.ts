// npx vitest run core/task/__tests__/Task.spec.ts

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import * as vscode from "vscode"
import { Anthropic } from "@anthropic-ai/sdk"

import { type ProviderSettings, type ModelInfo, TelemetryEventName } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { Task, type TaskOptions } from "../Task"
import { resetGlobalApiRequestTime } from "../RetryHandler"
import { ClineProvider } from "../../webview/ClineProvider"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { ContextProxy } from "../../config/ContextProxy"
import type { ApiMessage } from "../../task-persistence/apiMessages"

// Mock delay before any imports that might use it
vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

import delay from "delay"
import * as fsPromises from "fs/promises"
import { logger } from "../../../utils/logging"

vi.mock("uuid", async (importOriginal) => {
	const actual = await importOriginal<typeof import("uuid")>()
	return {
		...actual,
		v7: vi.fn(() => "00000000-0000-7000-8000-000000000000"),
	}
})

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	const mockFunctions = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockImplementation((filePath) => {
			if (filePath.includes("ui_messages.json")) {
				return Promise.resolve(JSON.stringify(mockMessages))
			}
			if (filePath.includes("api_conversation_history.json")) {
				return Promise.resolve(
					JSON.stringify([
						{
							role: "user",
							content: [{ type: "text", text: "historical task" }],
							ts: Date.now(),
						},
						{
							role: "assistant",
							content: [{ type: "text", text: "I'll help you with that task." }],
							ts: Date.now(),
						},
					]),
				)
			}
			return Promise.resolve("[]")
		}),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
		stat: vi.fn().mockRejectedValue({ code: "ENOENT" }),
		readdir: vi.fn().mockResolvedValue([]),
	}

	return {
		...actual,
		...mockFunctions,
		default: mockFunctions,
	}
})

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		TabInputTextDiff: vi.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		window: {
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			visibleTextEditors: [mockTextEditor],
			tabGroups: {
				all: [mockTabGroup],
				close: vi.fn(),
				onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
			},
			showErrorMessage: vi.fn(),
		},
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: "/mock/workspace/path" },
					name: "mock-workspace",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
			fs: {
				stat: vi.fn().mockResolvedValue({ type: 1 }), // FileType.File = 1
			},
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
			getConfiguration: vi.fn(() => ({ get: (key: string, defaultValue: any) => defaultValue })),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(function () {
			return mockEventEmitter
		}),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
	}
})

vi.mock("../../mentions", () => ({
	parseMentions: vi.fn().mockImplementation((text) => {
		return Promise.resolve({ text: `processed: ${text}`, mode: undefined, contentBlocks: [] })
	}),
	openMention: vi.fn(),
	getLatestTerminalOutput: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("../../condense", async (importOriginal) => {
	const actual = (await importOriginal()) as any
	return {
		...actual,
		summarizeConversation: vi.fn().mockResolvedValue({
			messages: [{ role: "user", content: [{ type: "text", text: "continued" }], ts: Date.now() }],
			summary: "summary",
			cost: 0,
			newContextTokens: 1,
		}),
	}
})
// Mock storagePathManager to prevent dynamic import issues.
// getStorageBasePath is deliberately NOT mocked: the real ClineProvider used
// as mockProvider acquires a TaskHistoryStore in its constructor, and the
// missing export makes that init fail fast BEFORE the store starts fs
// watchers and self-rescheduling reconcile timers. Completing the mock
// activates that machinery for every constructed provider and hangs the
// fake-timer condense tests (runAllTimers loops on the reconcile timer).
vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation((filePath) => {
		return filePath.includes("ui_messages.json") || filePath.includes("api_conversation_history.json")
	}),
}))

const mockMessages = [
	{
		ts: Date.now(),
		type: "say",
		say: "text",
		text: "historical task",
	},
]

// Several describes below use a REAL ClineProvider as their mock provider, so
// completing/aborting a task fires the real memory background writers
// (extraction + autoDream). Those are irrelevant here: autoDream's
// getTaskHistory round-trip hits the incomplete utils/storage mock and logs
// "[memory] autoDream trigger failed" after every abort-path test. Kill the
// writers via the env master switch (TaskLifecycle gates on it before doing
// any work); save/restore because the Windows CI single fork shares
// process.env across all test files.
let priorDisableAutoMemory: string | undefined
beforeAll(() => {
	priorDisableAutoMemory = process.env.ROO_DISABLE_AUTO_MEMORY
	process.env.ROO_DISABLE_AUTO_MEMORY = "1"
})
afterAll(() => {
	if (priorDisableAutoMemory === undefined) {
		delete process.env.ROO_DISABLE_AUTO_MEMORY
	} else {
		process.env.ROO_DISABLE_AUTO_MEMORY = priorDisableAutoMemory
	}
})

const apiConfig: ProviderSettings = {
	apiProvider: "anthropic",
	apiModelId: "claude-3-5-sonnet-20241022",
	apiKey: "test-api-key",
}

const testModel = (info: Partial<ModelInfo> = {}) => ({
	id: "test-model",
	info: { contextWindow: 128000, maxTokens: 4096, supportsImages: false, supportsPromptCache: false, ...info },
})

/** A real ClineProvider over a fake extension context, with its webview posts stubbed. */
function makeProvider(): any {
	const context = {
		globalState: { get: vi.fn(), update: vi.fn().mockResolvedValue(undefined), keys: vi.fn().mockReturnValue([]) },
		globalStorageUri: { fsPath: path.join(os.tmpdir(), "test-storage") },
		workspaceState: {
			get: vi.fn(),
			update: vi.fn().mockResolvedValue(undefined),
			keys: vi.fn().mockReturnValue([]),
		},
		secrets: {
			get: vi.fn().mockResolvedValue(undefined),
			store: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
		},
		extensionUri: { fsPath: "/mock/extension/path" },
		extension: { packageJSON: { version: "1.0.0" } },
	} as unknown as vscode.ExtensionContext
	const output = {
		appendLine: vi.fn(),
		append: vi.fn(),
		clear: vi.fn(),
		show: vi.fn(),
		hide: vi.fn(),
		dispose: vi.fn(),
	}

	const provider = new ClineProvider(context, output as any, "sidebar", new ContextProxy(context)) as any
	provider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
	provider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
	provider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
	return provider
}

function newTask(provider: any, options: Partial<TaskOptions> = {}): Task {
	return new Task({ provider, apiConfiguration: apiConfig, task: "test task", startTask: false, ...options })
}

const stream = (...chunks: ApiStreamChunk[]) =>
	({
		async *[Symbol.asyncIterator]() {
			yield* chunks
		},
	}) as AsyncGenerator<ApiStreamChunk>

const failingStream = (error: Error) =>
	({
		// eslint-disable-next-line require-yield
		async *[Symbol.asyncIterator]() {
			throw error
		},
	}) as unknown as AsyncGenerator<ApiStreamChunk>

/** Provider state for a request: the provider's own state with `overrides` on top. */
async function stubState(provider: any, overrides: Record<string, unknown> = {}) {
	const state = await provider.getState()
	vi.spyOn(provider, "getState").mockResolvedValue({ ...state, apiConfiguration: apiConfig, ...overrides })
}

/** Runs one request cycle of `task` up to its first yielded chunk. */
async function requestOnce(task: Task) {
	await task.attemptApiRequest(0).next()
}

beforeEach(() => {
	if (!TelemetryService.hasInstance()) {
		TelemetryService.createInstance([])
	}
	resetGlobalApiRequestTime()
})

afterEach(() => {
	resetGlobalApiRequestTime()
	vi.restoreAllMocks()
})

describe("Task constructor", () => {
	let provider: any
	beforeEach(() => {
		provider = makeProvider()
	})

	it.each([
		{ limit: undefined, isBackground: false, configured: 3, effective: 3 },
		{ limit: 5, isBackground: false, configured: 5, effective: 5 },
		{ limit: 0, isBackground: false, configured: 0, effective: 0 },
		// A background task has nobody to lift "no limit": it keeps the default.
		{ limit: 0, isBackground: true, configured: 0, effective: 3 },
		{ limit: 5, isBackground: true, configured: 5, effective: 5 },
	])(
		"mistake limit $limit, background $isBackground: $configured configured, $effective effective",
		({ limit, isBackground, configured, effective }) => {
			const task = newTask(provider, { consecutiveMistakeLimit: limit, isBackground })

			expect(task.consecutiveMistakeLimit).toBe(configured)
			expect(task.effectiveMistakeLimit).toBe(effective)
		},
	)

	it("keeps the root id it is given for a new subtask", () => {
		const parent = newTask(provider)
		const child = newTask(provider, { parentTask: parent, rootTaskId: "root-task" })

		expect(child.rootTaskId).toBe("root-task")
		expect(child.parentTaskId).toBe(parent.taskId)
	})

	it("takes the root id from the history item when reopening a subtask", () => {
		const reopened = newTask(provider, {
			task: undefined,
			historyItem: {
				id: "child-task",
				number: 1,
				ts: Date.now(),
				task: "child task",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				parentTaskId: "parent-task",
				rootTaskId: "root-task",
			},
			rootTaskId: "ignored",
		})

		expect(reopened.rootTaskId).toBe("root-task")
	})

	it("requires either task or historyItem", () => {
		expect(() => newTask(provider, { task: undefined, startTask: true })).toThrow(
			"Either historyItem or task/images must be provided",
		)
	})

	it("start() starts the task once", () => {
		const task = newTask(provider)
		const startTask = vi.spyOn(task.lifecycle, "startTask").mockResolvedValue(undefined)

		task.start()
		task.start()

		expect(startTask).toHaveBeenCalledTimes(1)
	})
})

describe("Task request cycle", () => {
	let provider: any
	beforeEach(() => {
		provider = makeProvider()
	})

	function requestTask(options: Partial<TaskOptions> = {}) {
		const task = newTask(provider, options)
		vi.spyOn(task.apiLoop, "getSystemPrompt").mockResolvedValue("mock system prompt")
		return task
	}

	it("sends only role and content, with images shaped for a model without image support", async () => {
		const task = requestTask()
		vi.spyOn(task.api, "getModel").mockReturnValue(testModel({ supportsImages: false }) as any)
		const createMessage = vi.spyOn(task.api, "createMessage").mockReturnValue(stream({ type: "text", text: "ok" }))
		task.apiConversationHistory = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Here is an image" },
					{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "base64data" } },
				],
				ts: Date.now(),
				extraProp: "should be removed",
			},
		] as any

		await requestOnce(task)

		expect(createMessage.mock.calls[0][1]).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "Here is an image" },
					{ type: "text", text: "[Referenced image in conversation]" },
				],
			},
		])
	})

	it("counts down the request delay once before retrying a failed stream", async () => {
		const task = requestTask()
		const say = vi.spyOn(task.askSay, "say")
		vi.spyOn(task.api, "createMessage")
			.mockReturnValueOnce(failingStream(new Error("API Error")))
			.mockReturnValue(stream({ type: "text", text: "Success" }))
		await stubState(provider, { autoApprovalEnabled: true, requestDelaySeconds: 3 })

		await requestOnce(task)

		expect(say.mock.calls.filter(([type]) => type === "api_req_retry_delayed")).toEqual([
			["api_req_retry_delayed", "API Error\n<retry_timer>3</retry_timer>", undefined, true],
			["api_req_retry_delayed", "API Error\n<retry_timer>2</retry_timer>", undefined, true],
			["api_req_retry_delayed", "API Error\n<retry_timer>1</retry_timer>", undefined, true],
			["api_req_retry_delayed", "API Error\n", undefined, false],
		])
		expect(vi.mocked(delay).mock.calls).toEqual([[1000], [1000], [1000]])
	})

	describe("provider rate limit, shared by a parent and its subtasks", () => {
		// The countdown is derived from performance.now(); a fixed clock keeps the expected
		// number of one-second waits exact on a loaded CI machine.
		let now: number
		beforeEach(() => {
			now = 1_000_000
			vi.spyOn(performance, "now").mockImplementation(() => now)
			vi.mocked(delay).mockClear()
		})

		it.each([
			{ rateLimitSeconds: 5, elapsedMs: 0, waits: 5 },
			{ rateLimitSeconds: 5, elapsedMs: 2_500, waits: 3 },
			{ rateLimitSeconds: 5, elapsedMs: 6_000, waits: 0 },
			{ rateLimitSeconds: 0, elapsedMs: 0, waits: 0 },
		])(
			"limit $rateLimitSeconds s, $elapsedMs ms after the parent's request: $waits waits",
			async ({ rateLimitSeconds, elapsedMs, waits }) => {
				const limited = { ...apiConfig, rateLimitSeconds }
				await stubState(provider, { apiConfiguration: limited })
				const parent = requestTask({ apiConfiguration: limited })
				vi.spyOn(parent.api, "createMessage").mockReturnValue(stream({ type: "text", text: "parent" }))

				await requestOnce(parent)
				expect(delay).not.toHaveBeenCalled()

				now += elapsedMs
				const child = requestTask({ apiConfiguration: limited, parentTask: parent, rootTaskId: parent.taskId })
				vi.spyOn(child.api, "createMessage").mockReturnValue(stream({ type: "text", text: "child" }))
				const say = vi.spyOn(child.askSay, "say")

				await requestOnce(child)

				expect(delay).toHaveBeenCalledTimes(waits)
				const waitMessages = say.mock.calls.filter(([type]) => type === "api_req_rate_limit_wait")
				if (waits > 0) {
					expect(waitMessages[0]).toEqual([
						"api_req_rate_limit_wait",
						JSON.stringify({ seconds: waits }),
						undefined,
						true,
					])
					expect(waitMessages.at(-1)).toEqual(["api_req_rate_limit_wait", undefined, undefined, false])
				} else {
					expect(waitMessages).toEqual([])
				}
			},
		)
	})

	describe("context management before the request", () => {
		async function managedTask(options: { contextTokens: number; history: ApiMessage[]; taskMode?: string }) {
			await stubState(provider, {
				autoApprovalEnabled: false,
				requestDelaySeconds: 0,
				mode: "code",
				autoCondenseContext: true,
				autoCondenseContextPercent: 100,
				profileThresholds: {},
			})
			const task = requestTask({ taskMode: options.taskMode })
			const createMessage = vi
				.spyOn(task.api, "createMessage")
				.mockReturnValue(stream({ type: "text", text: "ok" }))
			vi.spyOn(task.api, "getModel").mockReturnValue(testModel() as any)
			task.apiConversationHistory = options.history
			vi.spyOn(task, "getTokenUsage").mockReturnValue({ contextTokens: options.contextTokens } as any)
			const countTokens = vi.spyOn(task.api, "countTokens").mockResolvedValue(500)
			const manageContext = vi
				.spyOn(task.contextManager, "manageContextIfNeeded")
				.mockResolvedValue(undefined as any)
			const buildTools = vi
				.spyOn(task.apiLoop as any, "buildToolsArray")
				.mockResolvedValue({ allTools: [], allowedFunctionNames: undefined })
			return { task, createMessage, countTokens, manageContext, buildTools }
		}

		it("AP-7 / DEF-C16: with no tracked usage, counts the whole history, tool blocks included", async () => {
			const fileBody = "export const a = 1\n".repeat(50)
			const { task, countTokens, manageContext } = await managedTask({
				contextTokens: 0,
				history: [
					{ role: "user", content: "Read a.ts", ts: 1 },
					{
						role: "assistant",
						content: [{ type: "tool_use", id: "call_1", name: "read_file", input: {} }],
						ts: 2,
					},
					{
						role: "user",
						content: [{ type: "tool_result", tool_use_id: "call_1", content: fileBody }],
						ts: 3,
					},
				],
			})

			await requestOnce(task)

			const fallbackBlocks = countTokens.mock.calls[0][0]
			expect(fallbackBlocks).toContainEqual(
				expect.objectContaining({ type: "tool_result", tool_use_id: "call_1", content: fileBody }),
			)
			expect(fallbackBlocks).toContainEqual(expect.objectContaining({ type: "tool_use", name: "read_file" }))
			expect(manageContext.mock.calls[0][0].contextTokens).toBeGreaterThan(0)
		})

		it("uses the tracked usage when there is some", async () => {
			const { task, manageContext } = await managedTask({
				contextTokens: 300,
				history: [{ role: "user", content: [{ type: "text", text: "Hello" }], ts: 1 }],
			})

			await requestOnce(task)

			expect(manageContext.mock.calls[0][0].contextTokens).toBe(300)
		})

		it("requests tools and metadata for the task's own mode, not the provider's", async () => {
			const { task, createMessage, buildTools } = await managedTask({
				contextTokens: 300,
				history: [{ role: "user", content: [{ type: "text", text: "Hello" }], ts: 1 }],
				taskMode: "architect",
			})

			await requestOnce(task)

			expect(buildTools.mock.calls[0][2]).toBe("architect")
			expect(createMessage.mock.calls[0][2]).toEqual(expect.objectContaining({ mode: "architect" }))
		})
	})

	// DEF-C33. The provider rejected a request as too big, and the forced pass decided that
	// clearing old tool output at send time (microcompaction) is enough. That decision lives
	// only in transient per-request state, so it has to reach the retry, or the retry resends
	// exactly the request the provider just rejected.
	describe("forced condense after a context-window error applies microcompaction to the retry", () => {
		const CONTEXT_WINDOW = 100_000
		// Big enough to be clearable (the floor is 2,000 chars), small enough that the forced
		// pass clears only a few of them.
		const RESULT_CHARS = 6_000

		function readFilePair(index: number): ApiMessage[] {
			const id = `read-${index}`
			const body = `file ${index}\n` + "const value = compute(input, options) // line of source\n".repeat(100)
			return [
				{
					role: "assistant",
					content: [{ type: "tool_use", id, name: "read_file", input: { path: `f${index}.ts` } }],
					ts: 1000 + index * 2,
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: id, content: body.slice(0, RESULT_CHARS) }],
					ts: 1001 + index * 2,
				},
			]
		}

		function clearedIdsIn(messages: any[]): string[] {
			return messages.flatMap((msg) =>
				Array.isArray(msg.content)
					? msg.content
							.filter(
								(block: any) =>
									block.type === "tool_result" &&
									JSON.stringify(block.content).includes("Old tool output cleared"),
							)
							.map((block: any) => block.tool_use_id)
					: [],
			)
		}

		/** A task whose first `rejections` requests fail as too big; `contextTokens` is the last reported size. */
		async function rejectedTask(rejections = 1) {
			// The user's normal threshold: the regular pass only acts near the hard limit.
			await stubState(provider, {
				autoApprovalEnabled: false,
				requestDelaySeconds: 0,
				mode: "code",
				autoCondenseContext: true,
				autoCondenseContextPercent: 100,
				profileThresholds: {},
			})
			const task = requestTask()
			vi.spyOn(task.api, "getModel").mockReturnValue(testModel({ contextWindow: CONTEXT_WINDOW }) as any)
			vi.spyOn(task.apiLoop as any, "buildToolsArray").mockResolvedValue({
				allTools: [],
				allowedFunctionNames: undefined,
			})
			task.apiConversationHistory = [
				{ role: "user", content: [{ type: "text", text: "task" }], ts: 999 },
				...Array.from({ length: 8 }, (_, i) => readFilePair(i)).flat(),
				{ role: "user", content: [{ type: "text", text: "continue" }], ts: 2000 },
			]
			// 78% of the window: under the user's thresholds, so the rejected request went out
			// whole, but over the forced pass's 75% target. A failed request reports no usage,
			// so the retry sees the same number.
			vi.spyOn(task, "getTokenUsage").mockReturnValue({ contextTokens: 78_000 } as any)

			let calls = 0
			const createMessage = vi.spyOn(task.api, "createMessage").mockImplementation(() => {
				calls += 1
				return calls <= rejections
					? failingStream(
							Object.assign(new Error("This model's maximum context length is 100000 tokens"), {
								status: 400,
							}),
						)
					: stream({ type: "text", text: "response" })
			})
			return { task, createMessage }
		}

		it("sends a smaller retry than the rejected request", async () => {
			const { task, createMessage } = await rejectedTask()
			const capture = vi.spyOn(TelemetryService.instance, "capture")

			await requestOnce(task)

			expect(createMessage).toHaveBeenCalledTimes(2)
			const microcompacted = capture.mock.calls.filter(
				([event]) => event === TelemetryEventName.CONTEXT_MICROCOMPACTED,
			)
			// Only the forced pass selected old results; the regular pass stays under its thresholds.
			expect(microcompacted).toHaveLength(1)
			expect((microcompacted[0]![1] as { cleared: number }).cleared).toBeGreaterThan(0)
			const rejected = createMessage.mock.calls[0][1] as any[]
			const retry = createMessage.mock.calls[1][1] as any[]
			expect(clearedIdsIn(rejected)).toEqual([])
			// Microcompaction alone: nothing was persisted.
			expect(task.apiConversationHistory.some((m) => m.isSummary || m.truncationParent)).toBe(false)
			expect(clearedIdsIn(retry).length).toBeGreaterThan(0)
			expect(JSON.stringify(retry).length).toBeLessThan(JSON.stringify(rejected).length)
			// The bookkeeping matches the wire, so the next threshold check adds the stripped size back.
			expect([...task.microcompactedIds].sort()).toEqual(clearedIdsIn(retry).sort())
			expect(task.microcompactStrippedTokens).toBeGreaterThan(0)
		})

		it("replaces a stale set left by an earlier pass in another mode", async () => {
			const { task, createMessage } = await rejectedTask()
			// An id that no longer resolves in this history. Mutated in place: the request
			// builder holds this very Set.
			task.microcompactedIds.add("stale-from-other-mode")
			task.microcompactStrippedTokens = 0

			await requestOnce(task)

			const retry = createMessage.mock.calls[1][1] as any[]
			expect(task.microcompactedIds.has("stale-from-other-mode")).toBe(false)
			expect([...task.microcompactedIds].sort()).toEqual(clearedIdsIn(retry).sort())
			expect(task.microcompactStrippedTokens).toBeGreaterThan(0)
		})

		it("strips more on a second rejection in a row instead of resending the same retry", async () => {
			const { task, createMessage } = await rejectedTask(2)

			await requestOnce(task)

			expect(createMessage).toHaveBeenCalledTimes(3)
			const firstRetry = createMessage.mock.calls[1][1] as any[]
			const secondRetry = createMessage.mock.calls[2][1] as any[]
			// The second pass measures the pristine size and keeps the first retry's clears.
			expect(clearedIdsIn(secondRetry)).toEqual(expect.arrayContaining(clearedIdsIn(firstRetry)))
			expect(clearedIdsIn(secondRetry).length).toBeGreaterThan(clearedIdsIn(firstRetry).length)
			expect(JSON.stringify(secondRetry).length).toBeLessThan(JSON.stringify(firstRetry).length)
		})
	})
})

describe("submitUserMessage", () => {
	let provider: any
	let task: Task
	let handleResponse: ReturnType<typeof vi.spyOn>
	beforeEach(() => {
		provider = makeProvider()
		task = newTask(provider)
		handleResponse = vi.spyOn(task.askSay, "handleWebviewAskResponse").mockImplementation(() => {})
	})

	it("hands the message to the task directly, not through the webview", async () => {
		await task.submitUserMessage("  test message ", ["image1.png"])

		expect(handleResponse).toHaveBeenCalledWith("messageResponse", "test message", ["image1.png"])
		expect(provider.postMessageToWebview).not.toHaveBeenCalled()
	})

	it.each([
		["empty", ""],
		["whitespace", "   "],
	])("ignores an %s message without images", async (_label, text) => {
		await task.submitUserMessage(text, [])

		expect(handleResponse).not.toHaveBeenCalled()
	})

	it("sends images without text", async () => {
		await task.submitUserMessage("", ["image1.png"])

		expect(handleResponse).toHaveBeenCalledWith("messageResponse", "", ["image1.png"])
	})

	it("switches the mode like the mode selector when the task is the focused one", async () => {
		// The task reads its own mode (not provider state) for prompts, tools and validation.
		vi.spyOn(provider, "getCurrentTask").mockReturnValue(task)
		const handleModeSwitch = vi.spyOn(provider, "handleModeSwitch").mockResolvedValue(undefined)
		const setMode = vi.spyOn(provider, "setMode").mockResolvedValue(undefined)

		await task.submitUserMessage("plan it", [], "architect")

		expect(handleModeSwitch).toHaveBeenCalledWith("architect")
		expect(setMode).not.toHaveBeenCalled()
	})

	it("sets the mode directly when the task is not the focused one", async () => {
		vi.spyOn(provider, "getCurrentTask").mockReturnValue(undefined)
		const handleModeSwitch = vi.spyOn(provider, "handleModeSwitch").mockResolvedValue(undefined)
		const setMode = vi.spyOn(provider, "setMode").mockResolvedValue(undefined)

		await task.submitUserMessage("plan it", [], "architect")

		expect(setMode).toHaveBeenCalledWith("architect")
		expect(handleModeSwitch).not.toHaveBeenCalled()
	})

	it("switches to the named provider profile and takes its configuration", async () => {
		const profileConfig: ProviderSettings = { apiProvider: "openrouter", openRouterModelId: "some/model" }
		const setProviderProfile = vi.spyOn(provider, "setProviderProfile").mockResolvedValue(undefined)
		await stubState(provider, { apiConfiguration: profileConfig })

		await task.submitUserMessage("go", [], undefined, "cheap")

		expect(setProviderProfile).toHaveBeenCalledWith("cheap")
		expect(task.apiConfiguration).toEqual(profileConfig)
		expect(handleResponse).toHaveBeenCalledWith("messageResponse", "go", [])
	})

	it("logs and drops the message when the provider is gone", async () => {
		Object.defineProperty(task, "providerRef", { value: { deref: () => undefined } })
		const error = vi.spyOn(logger, "error").mockImplementation(() => {})

		await task.submitUserMessage("test message")

		expect(error).toHaveBeenCalledWith("[Task#submitUserMessage] Provider reference lost")
		expect(handleResponse).not.toHaveBeenCalled()
	})
})

describe("abortTask and dispose", () => {
	let task: Task
	beforeEach(() => {
		task = newTask(makeProvider())
	})

	it("sets the abort flag, resets the error streaks, emits TaskAborted and disposes", async () => {
		const emit = vi.spyOn(task, "emit")
		const dispose = vi.spyOn(task.lifecycle, "dispose").mockImplementation(() => {})
		task.consecutiveNoAssistantMessagesCount = 3
		task.consecutiveNoToolUseCount = 4

		await task.abortTask()

		expect(task.abort).toBe(true)
		expect(task.consecutiveNoAssistantMessagesCount).toBe(0)
		expect(task.consecutiveNoToolUseCount).toBe(0)
		expect(emit).toHaveBeenCalledWith("taskAborted")
		expect(dispose).toHaveBeenCalled()
	})

	it("still aborts when disposal throws", async () => {
		const failure = new Error("Disposal failed")
		vi.spyOn(task.lifecycle, "dispose").mockImplementation(() => {
			throw failure
		})
		const error = vi.spyOn(logger, "error").mockImplementation(() => {})

		await task.abortTask()

		expect(task.abort).toBe(true)
		expect(error).toHaveBeenCalledWith(expect.stringContaining("Error during task"), failure)
	})

	it("dispose cancels the current HTTP request", () => {
		const controller = new AbortController()
		task.currentRequestAbortController = controller

		task.dispose()

		expect(controller.signal.aborted).toBe(true)
		expect(task.currentRequestAbortController).toBeUndefined()
	})
})

describe("queued messages after a condense", () => {
	it("submits the task's own queued message and leaves another task's queue alone", async () => {
		const taskA = newTask(makeProvider())
		const taskB = newTask(makeProvider())
		for (const task of [taskA, taskB]) {
			vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("system")
		}
		const submitA = vi.spyOn(taskA, "submitUserMessage").mockResolvedValue(undefined)
		const submitB = vi.spyOn(taskB, "submitUserMessage").mockResolvedValue(undefined)
		taskA.messageQueueService.addMessage("queued text", ["img1.png"])
		taskB.messageQueueService.addMessage("B message")

		// Fake timers capture the setTimeout(0) that submits the queued message.
		vi.useFakeTimers()
		try {
			await taskA.condenseContext()
			vi.runAllTimers()
		} finally {
			vi.useRealTimers()
		}

		expect(submitA).toHaveBeenCalledWith("queued text", ["img1.png"])
		expect(taskA.messageQueueService.isEmpty()).toBe(true)
		expect(submitB).not.toHaveBeenCalled()
		expect(taskB.messageQueueService.isEmpty()).toBe(false)
	})
})

describe("pushToolResultToUserContent", () => {
	let provider: any
	beforeEach(() => {
		provider = makeProvider()
	})

	const result = (id: string, content: Anthropic.ToolResultBlockParam["content"] = `result ${id}`) =>
		({ type: "tool_result", tool_use_id: id, content }) as Anthropic.ToolResultBlockParam

	it("appends results after other content and skips a second result for the same tool_use_id", () => {
		const task = newTask(provider)
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
		task.userMessageContent.push({ type: "text", text: "Some text" })

		expect(task.pushToolResultToUserContent(result("id-1"))).toBe(true)
		expect(task.pushToolResultToUserContent(result("id-2"))).toBe(true)
		expect(task.pushToolResultToUserContent(result("id-1", "second"))).toBe(false)

		expect(task.userMessageContent).toEqual([{ type: "text", text: "Some text" }, result("id-1"), result("id-2")])
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Skipping duplicate tool_result for tool_use_id: id-1"),
		)
	})

	describe("tool-result spill policy", () => {
		/** 400 padded lines (about 32 KB): over every inline budget used here. */
		const hugeResult = Array.from({ length: 400 }, (_, index) => `line-${index + 1}`.padEnd(80, "x")).join("\n")

		const artifactsDirFor = (taskId: string) => path.join(os.tmpdir(), "test-storage", "tasks", taskId, "artifacts")

		// The file-level fs/promises mock makes writeFile a no-op; these tests check the artifact
		// on disk, and the atomic write goes through fs/promises.
		beforeEach(async () => {
			const actualFs = await vi.importActual<typeof import("fs/promises")>("fs/promises")
			vi.mocked(fsPromises.writeFile).mockImplementation(actualFs.writeFile as any)
		})

		// Every Task in this file shares one taskId (uuid is pinned): leave no artifacts behind.
		afterEach(() => {
			vi.mocked(fsPromises.writeFile).mockReset()
			vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined)
			fs.rmSync(artifactsDirFor("00000000-0000-7000-8000-000000000000"), { recursive: true, force: true })
		})

		const pushedContent = (task: Task) => (task.userMessageContent[0] as Anthropic.ToolResultBlockParam).content

		it("spills an oversized tool result and leaves a preview that cites the artifact", async () => {
			const task = newTask(provider)
			await task.ensureToolResultSpill(1024)

			task.pushToolResultToUserContent(result("spill-id", hugeResult), { toolName: "search_files" })

			// Until the artifact exists the result stays inline, so no preview cites a missing file.
			expect(pushedContent(task)).toBe(hugeResult)

			await task.settlePendingToolResultSpills()

			const content = pushedContent(task) as string
			expect(content).toMatch(/^\[Tool result: \d+ KB, showing first \d+ and last \d+ lines\./)
			expect(content).toContain("Use read_artifact (search/offset/limit) to inspect the rest.]")
			const artifactId = content.match(/artifact "([^"]+)"/)?.[1]
			expect(artifactId).toMatch(/^tool-\d+\.txt$/)
			expect(fs.readFileSync(path.join(artifactsDirFor(task.taskId), artifactId!), "utf8")).toBe(hugeResult)
		})

		it("keeps the result inline when the artifact write fails", async () => {
			const task = newTask(provider)
			const save = vi.fn().mockRejectedValue(new Error("ENOSPC: no space left on device"))
			;(task as any).toolResultSpill = { store: { save }, maxInlineBytes: 1024 }
			vi.spyOn(logger, "warn").mockImplementation(() => {})

			task.pushToolResultToUserContent(result("failed-spill-id", hugeResult), { toolName: "search_files" })
			await task.settlePendingToolResultSpills()

			expect(save).toHaveBeenCalledTimes(1)
			expect(pushedContent(task)).toBe(hugeResult)
		})

		it.each([
			["a protocol tool's result", "attempt_completion", true],
			["anything before the policy is prepared", "search_files", false],
		])("never spills %s", async (_label, toolName, prepared) => {
			const task = newTask(provider)
			if (prepared) {
				await task.ensureToolResultSpill(1024)
			}

			task.pushToolResultToUserContent(result("kept-id", hugeResult), { toolName })
			await task.settlePendingToolResultSpills()

			expect(pushedContent(task)).toBe(hugeResult)
			expect(fs.existsSync(artifactsDirFor(task.taskId))).toBe(false)
		})

		it("on a compact profile cuts a text result in place and leaves block content alone", async () => {
			const task = newTask(provider, { apiConfiguration: { ...apiConfig, compactProfile: true } })
			const blocks = [{ type: "text" as const, text: hugeResult }]

			task.pushToolResultToUserContent(result("text-id", hugeResult), { toolName: "some_mcp_tool" })
			task.pushToolResultToUserContent(result("blocks-id", blocks), { toolName: "some_mcp_tool" })
			await task.settlePendingToolResultSpills()

			const [text, kept] = task.userMessageContent as Anthropic.ToolResultBlockParam[]
			expect((text.content as string).length).toBeLessThan(hugeResult.length)
			expect(text.content).toContain(hugeResult.slice(0, 80))
			expect(kept.content).toBe(blocks)
			expect(fs.existsSync(artifactsDirFor(task.taskId))).toBe(false)
		})
	})
})
