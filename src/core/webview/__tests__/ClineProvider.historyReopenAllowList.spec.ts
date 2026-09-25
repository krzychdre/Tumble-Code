import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { RooCodeEventName, type OrganizationAllowList, type ProviderSettings } from "@roo-code/types"

import { ClineProvider } from "../ClineProvider"
import { Task } from "../../task/Task"
import { OrganizationAllowListViolationError } from "../../../utils/errors"

/**
 * DEF-C34: reopening a task from history must obey the organization allow
 * list exactly like starting a new task (`createTask`, see DEF-C6). The
 * profile a reopened task would run on is known only after
 * `createTaskWithHistoryItem` has restored the task's saved mode and profile,
 * so the check sits right before the Task is constructed.
 *
 * The callers differ in whether a rejection can reach the user by itself:
 * - history click (`showTaskWithId`, also used by the CLI), checkpoint
 *   restore and the extension API already surface a thrown error, so the
 *   rejection simply propagates;
 * - cancel (`cancelTask`), the streaming-failure rehydrate and the parent
 *   resume after a subtask (`reopenParentFromDelegation`) would swallow it or
 *   hand it to a task that no longer exists, so they show the message
 *   themselves and leave the task stack consistent.
 *
 * Harness mirrors ClineProvider.cancelTask-abort-race.spec.ts: a real
 * ClineProvider with its heavy collaborators mocked.
 */

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	return {
		workspace: {
			getConfiguration: vi.fn(() => ({
				get: vi.fn().mockReturnValue([]),
				update: vi.fn().mockResolvedValue(undefined),
			})),
			workspaceFolders: [],
			onDidChangeConfiguration: vi.fn(() => mockDisposable),
		},
		env: { uriScheme: "vscode", language: "en" },
		EventEmitter: vi.fn().mockImplementation(() => ({ event: vi.fn(), fire: vi.fn() })),
		Disposable: { from: vi.fn() },
		window: {
			showErrorMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidChangeActiveTextEditor: vi.fn(() => mockDisposable),
		},
		Uri: { file: vi.fn().mockReturnValue({ toString: () => "file://test" }) },
	}
})

vi.mock("../../task/Task")
vi.mock("../../config/ContextProxy")
vi.mock("../../../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		getInstance: vi.fn().mockResolvedValue({
			registerClient: vi.fn(),
			unregisterClient: vi.fn().mockResolvedValue(undefined),
		}),
	},
}))
vi.mock("../../../services/marketplace")
vi.mock("../../../integrations/workspace/WorkspaceTracker")
vi.mock("../../config/ProviderSettingsManager")
vi.mock("../../config/CustomModesManager")
vi.mock("../../../utils/path", () => ({ getWorkspacePath: vi.fn().mockReturnValue("/test/workspace") }))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { setProvider: vi.fn(), capture: vi.fn() } },
}))
vi.mock("@roo-code/cloud", () => ({
	CloudService: { hasInstance: vi.fn().mockReturnValue(false), instance: { isAuthenticated: vi.fn() } },
	getRooCodeApiUrl: vi.fn().mockReturnValue("https://api.example.com"),
}))
vi.mock("../../../shared/embeddingModels", () => ({ EMBEDDING_MODEL_PROFILES: [] }))
vi.mock("../../task-persistence", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>
	const store = {
		initialized: Promise.resolve(),
		onChange: vi.fn().mockReturnValue(vi.fn()),
		get: vi.fn(),
		getAll: vi.fn().mockReturnValue([]),
		upsert: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		deleteMany: vi.fn().mockResolvedValue(undefined),
		migrateFromLegacyHistory: vi.fn().mockResolvedValue(true),
	}
	return {
		...actual,
		TaskHistoryStore: { acquire: vi.fn().mockResolvedValue({ store, dispose: vi.fn() }) },
		readApiMessages: vi.fn().mockResolvedValue([]),
		saveApiMessages: vi.fn().mockResolvedValue(undefined),
		saveTaskMessages: vi.fn().mockResolvedValue(undefined),
	}
})
vi.mock("../../task-persistence/taskMessages", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>
	return { ...actual, readTaskMessages: vi.fn().mockResolvedValue([]) }
})

const ALLOW_ONLY_ANTHROPIC: OrganizationAllowList = {
	allowAll: false,
	providers: { anthropic: { allowAll: true } },
}

const ALLOWED_PROFILE: ProviderSettings = {
	apiProvider: "anthropic",
	apiModelId: "claude-sonnet-4-5",
	consecutiveMistakeLimit: 7,
}

const DISALLOWED_PROFILE: ProviderSettings = {
	apiProvider: "openrouter",
	openRouterModelId: "some/model",
	consecutiveMistakeLimit: 7,
}

function historyItem(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		number: 1,
		ts: 1,
		task: `task ${id}`,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		workspace: "/test/workspace",
		...extra,
	} as any
}

function fakeTask(taskId: string, extra: Record<string, unknown> = {}): any {
	return {
		taskId,
		instanceId: `${taskId}-inst`,
		rootTask: undefined,
		parentTask: undefined,
		isStreaming: false,
		didFinishAbortingStream: true,
		isWaitingForFirstChunk: false,
		abandoned: false,
		abort: false,
		emit: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		cancelCurrentRequest: vi.fn(),
		abortTask: vi.fn().mockResolvedValue(undefined),
		...extra,
	}
}

describe("Reopening a task from history obeys the organization allow list (DEF-C34)", () => {
	let provider: ClineProvider
	let stack: any[]

	function useProfile(profile: ProviderSettings) {
		provider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: profile,
			organizationAllowList: ALLOW_ONLY_ANTHROPIC,
			enableCheckpoints: false,
			checkpointTimeout: 15,
			experiments: {},
		}) as any
	}

	beforeEach(() => {
		vi.clearAllMocks()

		vi.mocked(Task).mockImplementation(
			(options: any) => fakeTask(options.historyItem?.id ?? "new", { options, isBackground: false }) as any,
		)

		const context: any = {
			globalState: { get: vi.fn(), update: vi.fn().mockResolvedValue(undefined), keys: vi.fn(() => []) },
			globalStorageUri: { fsPath: "/test/storage" },
			secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
			workspaceState: { get: vi.fn(), update: vi.fn().mockResolvedValue(undefined), keys: vi.fn(() => []) },
			extensionUri: { fsPath: "/test/extension" },
		}
		const contextProxy: any = {
			getValues: vi.fn().mockReturnValue({}),
			getValue: vi.fn(),
			setValue: vi.fn().mockResolvedValue(undefined),
			getProviderSettings: vi.fn().mockReturnValue({ apiProvider: "anthropic" }),
			setProviderSettings: vi.fn().mockResolvedValue(undefined),
			extensionUri: context.extensionUri,
			globalStorageUri: context.globalStorageUri,
		}

		provider = new ClineProvider(context, { appendLine: vi.fn(), dispose: vi.fn() } as any, "sidebar", contextProxy)
		provider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		provider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		provider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		provider.updateTaskHistory = vi.fn().mockResolvedValue([]) as any

		stack = []
		;(provider as any).clineStack = stack
		provider.addClineToStack = vi.fn(async (task: any) => {
			stack.push(task)
		}) as any
		provider.removeClineFromStack = vi.fn(async () => {
			stack.pop()
		}) as any
	})

	describe("createTaskWithHistoryItem", () => {
		it("rejects a task whose profile the organization disallows, without constructing it", async () => {
			useProfile(DISALLOWED_PROFILE)
			stack.push(fakeTask("other"))

			await expect(provider.createTaskWithHistoryItem(historyItem("old"))).rejects.toBeInstanceOf(
				OrganizationAllowListViolationError,
			)

			expect(Task).not.toHaveBeenCalled()
			expect(provider.addClineToStack).not.toHaveBeenCalled()
			// The previously open task was closed first (same as createTask);
			// the webview is told so it does not keep showing it.
			expect(stack).toHaveLength(0)
			expect(provider.postStateToWebview).toHaveBeenCalled()
		})

		it("opens a task whose profile is allowed, as before", async () => {
			useProfile(ALLOWED_PROFILE)

			const task: any = await provider.createTaskWithHistoryItem(historyItem("old"))

			expect(Task).toHaveBeenCalledTimes(1)
			expect(task.options.apiConfiguration).toBe(ALLOWED_PROFILE)
			expect(task.options.consecutiveMistakeLimit).toBe(7)
			expect(stack).toEqual([task])
		})

		it("keeps the current task in place when rehydrating it on a disallowed profile", async () => {
			useProfile(DISALLOWED_PROFILE)
			const current = fakeTask("same")
			stack.push(current)

			await expect(provider.createTaskWithHistoryItem(historyItem("same"))).rejects.toBeInstanceOf(
				OrganizationAllowListViolationError,
			)

			expect(stack).toEqual([current])
			expect(current.abortTask).not.toHaveBeenCalled()
			expect(Task).not.toHaveBeenCalled()
		})
	})

	it("history click: the rejection propagates to the webview handler and the chat view is not opened", async () => {
		useProfile(DISALLOWED_PROFILE)
		provider.getHistoryItem = vi.fn().mockResolvedValue(historyItem("old")) as any

		await expect(provider.showTaskWithId("old")).rejects.toBeInstanceOf(OrganizationAllowListViolationError)

		expect(provider.postMessageToWebview).not.toHaveBeenCalledWith({
			type: "action",
			action: "chatButtonClicked",
		})
	})

	it("cancel: the stopped task stays on screen and the user is told why it cannot resume", async () => {
		useProfile(DISALLOWED_PROFILE)
		const current = fakeTask("running", { isStreaming: true })
		current.abortTask = vi.fn(async () => {
			current.abort = true
			current.isStreaming = false
		})
		stack.push(current)
		provider.getHistoryItem = vi.fn().mockResolvedValue(historyItem("running")) as any

		await expect(provider.cancelTask()).resolves.toBeUndefined()

		expect(stack).toEqual([current])
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.any(String))
		expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0]).toMatch(/organization/i)
	})

	it("streaming failure: the rehydrate rejection is shown to the user instead of only logged", async () => {
		useProfile(DISALLOWED_PROFILE)
		const failed = fakeTask("streaming", { abortReason: "streaming_failed", isBackground: false })
		stack.push(failed)
		provider.getHistoryItem = vi.fn().mockResolvedValue(historyItem("streaming")) as any
		;(provider as any).taskCreationCallback(failed)
		const onAborted = failed.on.mock.calls.find(([event]: [string]) => event === RooCodeEventName.TaskAborted)[1]
		await onAborted()

		expect(stack).toEqual([failed])
		expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1)
		expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0]).toMatch(/organization/i)
	})

	it("subtask return: a disallowed parent is not resumed, the user is told, and the delegation still completes", async () => {
		useProfile(DISALLOWED_PROFILE)
		const child = fakeTask("child", { parentTaskId: "parent" })
		stack.push(child)
		provider.getHistoryItem = vi.fn(async (id: string) =>
			id === "parent"
				? historyItem("parent", { status: "delegated", awaitingChildId: "child" })
				: historyItem("child", { status: "active", parentTaskId: "parent" }),
		) as any
		const emitted: string[] = []
		const originalEmit = provider.emit.bind(provider)
		provider.emit = ((event: string, ...args: unknown[]) => {
			emitted.push(event)
			return originalEmit(event as any, ...(args as any))
		}) as any

		// `true` tells AttemptCompletionTool the result was delivered; `false`
		// would make the (already closed) child fall through to its own
		// completion ask.
		await expect(
			provider.reopenParentFromDelegation({
				parentTaskId: "parent",
				childTaskId: "child",
				completionResultSummary: "done",
			}),
		).resolves.toBe(true)

		// The parent's history already records the result, so it can be reopened
		// from history once its profile is allowed again.
		expect(provider.updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({ id: "parent", status: "active", completionResultSummary: "done" }),
		)
		expect(Task).not.toHaveBeenCalled()
		expect(stack).toHaveLength(0)
		expect(emitted).toContain(RooCodeEventName.TaskDelegationCompleted)
		expect(emitted).not.toContain(RooCodeEventName.TaskDelegationResumed)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1)
		expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0]).toMatch(/organization/i)
	})
})
