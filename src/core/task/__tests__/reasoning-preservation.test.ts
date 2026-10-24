import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ClineProvider } from "../../webview/ClineProvider"
import type { ProviderSettings } from "@tumble-code/types"

// All vi.mock() calls are hoisted to the top of the file by Vitest
// and are applied before any imports are resolved

// Mock vscode module before importing Task
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(),
			onDidChange: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		})),
		getConfiguration: vi.fn(() => ({
			get: vi.fn(() => true),
		})),
		openTextDocument: vi.fn(),
		applyEdit: vi.fn(),
	},
	RelativePattern: vi.fn(function (base, pattern) {
		return { base, pattern }
	}),
	window: {
		createOutputChannel: vi.fn(() => ({
			appendLine: vi.fn(),
			dispose: vi.fn(),
		})),
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
		showTextDocument: vi.fn(),
		activeTextEditor: undefined,
	},
	Uri: {
		file: vi.fn((path) => ({ fsPath: path })),
		parse: vi.fn((str) => ({ toString: () => str })),
	},
	Range: vi.fn(),
	Position: vi.fn(),
	WorkspaceEdit: vi.fn(() => ({
		replace: vi.fn(),
		insert: vi.fn(),
		delete: vi.fn(),
	})),
	ViewColumn: {
		One: 1,
		Two: 2,
		Three: 3,
	},
}))

// Mock other dependencies
vi.mock("../../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		getInstance: vi.fn().mockResolvedValue(null),
	},
}))

vi.mock("../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		releaseTerminalsForTask: vi.fn(),
	},
}))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			capture: vi.fn(),
		},
	},
}))

vi.mock("@tumble-code/cloud", () => ({
	CloudService: {
		isEnabled: () => false,
	},
}))

// Mock delay to prevent actual delays
vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

// Mock p-wait-for to prevent hanging on async conditions
vi.mock("p-wait-for", () => ({
	default: vi.fn().mockResolvedValue(undefined),
}))

// Mock execa
vi.mock("execa", () => ({
	execa: vi.fn(),
}))

// Mock fs/promises
vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue("[]"),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
}))

// Mock mentions
vi.mock("../../mentions", () => ({
	parseMentions: vi.fn().mockImplementation((text) => Promise.resolve({ text, mode: undefined, contentBlocks: [] })),
	openMention: vi.fn(),
	getLatestTerminalOutput: vi.fn(),
}))

// Mock extract-text
vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

// Mock getEnvironmentDetails
vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

// Mock RooIgnoreController
vi.mock("../../ignore/RooIgnoreController")

// Mock condense
vi.mock("../../condense", () => ({
	summarizeConversation: vi.fn().mockResolvedValue({
		messages: [],
		summary: "summary",
		cost: 0,
		newContextTokens: 1,
	}),
}))

// Mock storage utilities
vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
}))

// Mock fs utilities
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockReturnValue(false),
}))

// Import Task AFTER all vi.mock() calls - Vitest hoists mocks so this works
import { Task } from "../Task"

describe("Task reasoning preservation in API history", () => {
	function newTask(api: unknown): Task {
		const provider = {
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
			getState: vi.fn().mockResolvedValue({ mode: "code", experiments: {} }),
			context: { globalStorageUri: { fsPath: "/test/storage" }, extensionPath: "/test/extension" },
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		}
		const task = new Task({
			provider: provider as unknown as ClineProvider,
			apiConfiguration: { apiProvider: "anthropic", apiKey: "test-key" } as ProviderSettings,
			task: "Test task",
			startTask: false,
		})
		task.api = api as Task["api"]
		return task
	}

	const answer = { role: "assistant" as const, content: [{ type: "text" as const, text: "Here is my response." }] }

	it("stores the provider's encrypted reasoning first and the response id on the message", async () => {
		const task = newTask({
			getEncryptedContent: vi.fn().mockReturnValue({ encrypted_content: "encrypted_payload", id: "rs_test" }),
			getResponseId: vi.fn().mockReturnValue("resp_test"),
		})

		await task.history.addToApiConversationHistory(answer)

		expect(task.apiConversationHistory).toEqual([
			expect.objectContaining({
				role: "assistant",
				id: "resp_test",
				content: [
					expect.objectContaining({
						type: "reasoning",
						encrypted_content: "encrypted_payload",
						id: "rs_test",
					}),
					{ type: "text", text: "Here is my response." },
				],
			}),
		])
	})

	it("stores streamed plain-text reasoning first when the provider has no encrypted content", async () => {
		const task = newTask({
			getModel: vi.fn().mockReturnValue({ id: "test-model", info: { contextWindow: 16000 } }),
		})
		const reasoning = "Let me analyze this carefully."

		await task.history.addToApiConversationHistory(answer, reasoning)

		const [reasoningBlock, textBlock] = task.apiConversationHistory[0].content as any[]
		expect(reasoningBlock).toEqual({ type: "reasoning", text: reasoning, summary: [] })
		expect(textBlock).toEqual({ type: "text", text: "Here is my response." })
	})

	it("stores the answer alone when there is no reasoning of either kind", async () => {
		const task = newTask({
			getModel: vi.fn().mockReturnValue({ id: "test-model", info: { contextWindow: 16000 } }),
		})

		await task.history.addToApiConversationHistory(answer)

		expect(task.apiConversationHistory[0].content).toEqual(answer.content)
	})
})
