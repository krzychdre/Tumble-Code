// npx vitest run core/task/__tests__/flushPendingToolResultsToHistory.spec.ts

import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import type { ProviderSettings } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { TaskHistoryStore } from "../../task-persistence"
import { ContextProxy } from "../../config/ContextProxy"

// Mock delay before any imports that might use it
vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("@tumble-code/core/fs", () => {
	const write = vi.fn().mockResolvedValue(undefined)
	return {
		safeWriteJson: write,
		writeFileAtomic: vi.fn().mockResolvedValue(undefined),
		withLockedJsonTransaction: vi.fn(
			async <T>(
				_lockTarget: string,
				destination: string,
				body: (writeJson: (data: unknown) => Promise<void>) => Promise<T>,
			) => body((data) => write(destination, data)),
		),
	}
})

// The JSON transaction gateway is mocked above; keep proper-lockfile inert for
// unrelated safe-write call sites in these specs.
vi.mock("proper-lockfile", () => ({
	lock: vi.fn(async () => async () => {}),
	unlock: vi.fn(async () => {}),
	check: vi.fn(async () => false),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	const mockFunctions = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue("[]"),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
	}

	return {
		...actual,
		...mockFunctions,
		default: mockFunctions,
	}
})

const { mockPWaitFor } = vi.hoisted(() => {
	return { mockPWaitFor: vi.fn().mockImplementation(async () => Promise.resolve()) }
})

vi.mock("p-wait-for", () => ({
	default: mockPWaitFor,
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
				stat: vi.fn().mockResolvedValue({ type: 1 }),
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

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
	// Shared TaskHistoryStore needs this to locate its tasks dir during
	// initialize(); a passthrough keeps the store's init no-op-friendly.
	getStorageBasePath: vi.fn().mockImplementation((globalStoragePath) => Promise.resolve(globalStoragePath)),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockReturnValue(false),
}))

function makeTask(): Task {
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
	provider.updateTaskHistory = vi.fn().mockResolvedValue(undefined)
	const apiConfiguration: ProviderSettings = {
		apiProvider: "anthropic",
		apiModelId: "claude-3-5-sonnet-20241022",
		apiKey: "test-api-key",
	}
	return new Task({ provider, apiConfiguration, task: "test task", startTask: false })
}

const result = (id: string, content = `result ${id}`) => ({ type: "tool_result" as const, tool_use_id: id, content })

describe("flushPendingToolResultsToHistory", () => {
	beforeEach(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
		mockPWaitFor.mockClear()
	})

	afterEach(() => {
		// Reset the process-wide shared TaskHistoryStore registry between cases.
		TaskHistoryStore.resetSharedStoresForTests()
	})

	it("saves nothing when no tool result is pending", async () => {
		const task = makeTask()

		await task.flushPendingToolResultsToHistory()

		expect(task.apiConversationHistory).toEqual([])
	})

	it("saves the pending results as one timestamped user message and clears them", async () => {
		const task = makeTask()
		task.assistantMessageSavedToHistory = true
		task.userMessageContent = [result("tool-1"), result("tool-2")]
		const before = Date.now()

		await task.flushPendingToolResultsToHistory()

		expect(task.apiConversationHistory).toEqual([
			{ role: "user", content: [result("tool-1"), result("tool-2")], ts: expect.any(Number) },
		])
		expect(task.apiConversationHistory[0].ts).toBeGreaterThanOrEqual(before)
		expect(task.userMessageContent).toEqual([])
	})

	it.each([
		[true, false],
		[false, true],
	])("with the assistant message saved = %s, waits for it: %s", async (assistantMessageSaved, waits) => {
		const task = makeTask()
		task.assistantMessageSavedToHistory = assistantMessageSaved
		task.userMessageContent = [result("tool-1")]

		await task.flushPendingToolResultsToHistory()

		expect(mockPWaitFor).toHaveBeenCalledTimes(waits ? 1 : 0)
		expect(task.apiConversationHistory).toHaveLength(1)
	})

	it("saves nothing when the task was aborted during the wait", async () => {
		const task = makeTask()
		task.userMessageContent = [result("tool-aborted")]
		task.abort = true

		await task.flushPendingToolResultsToHistory()

		expect(task.apiConversationHistory).toEqual([])
	})

	// P10: the spill write is asynchronous, and the preview only replaces the inline text once
	// the artifact file exists. A flush (delegation, abort) must settle those writes first, or the
	// persisted history keeps the full text and the artifact on disk is an orphan.
	it("persists the spill preview once a pending artifact write settles", async () => {
		const task = makeTask()
		task.assistantMessageSavedToHistory = true
		const hugeResult = Array.from({ length: 400 }, (_, index) => `line-${index + 1}`.padEnd(80, "x")).join("\n")
		const save = vi.fn(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve({ id: "tool-42.txt", bytes: hugeResult.length, path: "unused" }), 20),
				),
		)
		;(task as any).toolResultSpill = { store: { save }, maxInlineBytes: 1024 }

		task.pushToolResultToUserContent(result("spill-1", hugeResult), { toolName: "search_files" })
		await task.flushPendingToolResultsToHistory()

		expect(save).toHaveBeenCalledTimes(1)
		const flushed = (task.apiConversationHistory[0].content as any[])[0]
		expect(flushed.tool_use_id).toBe("spill-1")
		expect(flushed.content).toContain('Full output saved as artifact "tool-42.txt"')
		expect(flushed.content.length).toBeLessThan(hugeResult.length)
	})
})
