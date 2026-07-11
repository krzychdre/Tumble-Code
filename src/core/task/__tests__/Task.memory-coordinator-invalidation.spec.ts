// npx vitest run core/task/__tests__/Task.memory-coordinator-invalidation.spec.ts

// Regression test for MEM-1: MemoryCoordinator caches a stale ApiHandler
// after a mid-task profile switch.
//
// Task.memoryCoordinator is a lazy getter that constructs a MemoryCoordinator
// bound to `this.api` and caches it in `_memoryCoordinator`. When
// `updateApiConfiguration` rebuilds `this.api` (e.g. on profile switch), the
// cached coordinator must be invalidated so the next access rebuilds it against
// the new handler. Otherwise memory-recall side-queries keep running on the
// old (potentially dead-credentials) handler and silently return [].

import * as vscode from "vscode"

import type { ProviderSettings } from "@roo-code/types"
import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"

// Track every ApiHandler we hand out so the test can distinguish handler A
// from handler B. vi.hoisted ensures these are initialized before vi.mock
// factories run (factories are hoisted to the top of the file).
const { handlerA, handlerB, buildCallCount } = vi.hoisted(() => {
	const a = {
		completePrompt: vi.fn().mockResolvedValue('{"selected_memories":[]}'),
		getModel: vi.fn().mockReturnValue({ info: {}, id: "model-a" }),
	}
	const b = {
		completePrompt: vi.fn().mockResolvedValue('{"selected_memories":[]}'),
		getModel: vi.fn().mockReturnValue({ info: {}, id: "model-b" }),
	}
	return {
		handlerA: a,
		handlerB: b,
		buildCallCount: { value: 0 },
	}
})

vi.mock("../../../api", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	return {
		...actual,
		// First call (constructor) returns handlerA; second call
		// (updateApiConfiguration) returns handlerB.
		buildApiHandler: vi.fn(() => {
			buildCallCount.value++
			return buildCallCount.value === 1 ? handlerA : handlerB
		}),
	}
})

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		createInstance: vi.fn(),
		get instance() {
			return {
				captureTaskCreated: vi.fn(),
				captureTaskRestarted: vi.fn(),
				captureModeSwitch: vi.fn(),
				captureConversationMessage: vi.fn(),
				captureLlmCompletion: vi.fn(),
				captureConsecutiveMistakeError: vi.fn(),
				captureCodeActionUsed: vi.fn(),
				setProvider: vi.fn(),
			}
		},
	},
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
			getConfiguration: vi.fn(() => ({ get: (_k: string, d: any) => d })),
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
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
		version: "1.85.0",
	}
})

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

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
	return {
		...actual,
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue("[]"),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
		stat: vi.fn().mockRejectedValue({ code: "ENOENT" }),
		readdir: vi.fn().mockResolvedValue([]),
	}
})

// Force memory to be enabled so the coordinator getter doesn't early-return.
vi.mock("../../memory/paths", () => ({
	isAutoMemoryEnabled: vi.fn().mockReturnValue(true),
}))

// Capture the apiHandler passed to each MemoryCoordinator construction so the
// test can assert which ApiHandler the coordinator is bound to without needing
// to drive the full side-query → completePrompt path (which requires real
// memory files on disk). Hoisted so the mock factory can access them.
const { coordinatorConstructions, coordinatorInstanceCount, resetCoordinatorTracking } = vi.hoisted(() => {
	const constructions: Array<{ apiHandler: unknown }> = []
	const counter = { value: 0 }
	return {
		coordinatorConstructions: constructions,
		coordinatorInstanceCount: counter,
		resetCoordinatorTracking: () => {
			constructions.length = 0
			counter.value = 0
		},
	}
})

vi.mock("../../memory/memoryTaskIntegration", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>

	class CapturingCoordinator extends actual.MemoryCoordinator {
		constructor(params: {
			cwd: string
			recallEnabled: boolean
			readFileState: Map<string, unknown>
			apiHandler?: unknown
		}) {
			super(params)
			coordinatorInstanceCount.value++
			coordinatorConstructions.push({ apiHandler: params.apiHandler })
		}
	}

	return {
		...actual,
		MemoryCoordinator: CapturingCoordinator,
	}
})

describe("Task — MemoryCoordinator invalidation on API config change (MEM-1)", () => {
	const apiConfig: ProviderSettings = {
		apiProvider: "anthropic",
		apiModelId: "claude-3-5-sonnet-20241022",
		apiKey: "key-A",
	} as any

	const apiConfigB: ProviderSettings = {
		apiProvider: "anthropic",
		apiModelId: "claude-3-5-sonnet-20241022",
		apiKey: "key-B",
	} as any

	function makeProvider(): ClineProvider {
		return {
			context: {
				globalStorageUri: { fsPath: "/test/storage" },
			},
			getState: vi.fn().mockResolvedValue({}),
			getValue: vi.fn().mockReturnValue(true),
			log: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
		} as unknown as ClineProvider
	}

	beforeEach(() => {
		resetCoordinatorTracking()
		buildCallCount.value = 0
	})

	it("rebuilds the MemoryCoordinator after updateApiConfiguration (new handler binding)", () => {
		const provider = makeProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "test task",
			startTask: false,
		})

		// 1. First access caches the coordinator bound to handler A.
		const coordA = task.memoryCoordinator
		expect(coordA).toBeDefined()
		expect(coordinatorInstanceCount.value).toBe(1)
		expect(coordinatorConstructions[0].apiHandler).toBe(handlerA)

		// 2. Switch the API configuration mid-task (rebuilds this.api → handler B).
		task.updateApiConfiguration(apiConfigB)

		// 3. Second access must return a NEW coordinator bound to handler B.
		const coordB = task.memoryCoordinator
		expect(coordB).toBeDefined()
		expect(coordB).not.toBe(coordA)
		expect(coordinatorInstanceCount.value).toBe(2)
		expect(coordinatorConstructions[1].apiHandler).toBe(handlerB)
	})

	it("does not invalidate the coordinator when API config is unchanged", () => {
		const provider = makeProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "test task",
			startTask: false,
		})

		const coordBefore = task.memoryCoordinator
		// Re-access without any config change — same cached instance.
		const coordAfter = task.memoryCoordinator
		expect(coordAfter).toBe(coordBefore)
		expect(coordinatorInstanceCount.value).toBe(1)
	})
})
