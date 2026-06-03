import { CodeIndexManager } from "../manager"
import * as path from "path"

// Minimal but functional EventEmitter (defined inside the hoisted factory) so the real
// CodeIndexStateManager can notify the manager's auto-retry subscription. This is the key
// difference from manager.spec.ts, which stubs out the state manager entirely.
vi.mock("vscode", () => {
	class FakeEventEmitter<T> {
		private listeners: Array<(e: T) => void> = []
		event = (listener: (e: T) => void) => {
			this.listeners.push(listener)
			return { dispose: () => {} }
		}
		fire = (data: T) => {
			this.listeners.forEach((l) => l(data))
		}
		dispose = () => {
			this.listeners = []
		}
	}
	const testPath = require("path")
	const testWorkspacePath = testPath.join(testPath.sep, "test", "workspace")
	return {
		EventEmitter: FakeEventEmitter,
		Uri: {
			file: (p: string) => ({ fsPath: p, scheme: "file", authority: "", path: p, toString: () => `file://${p}` }),
			joinPath: vi.fn((...args: any[]) => ({ fsPath: args.join("/") })),
		},
		window: { activeTextEditor: null },
		workspace: {
			workspaceFolders: [
				{
					uri: {
						fsPath: testWorkspacePath,
						scheme: "file",
						authority: "",
						path: testWorkspacePath,
						toString: () => `file://${testWorkspacePath}`,
					},
					name: "test",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn().mockReturnValue({
				onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				dispose: vi.fn(),
			}),
			getWorkspaceFolder: vi.fn(),
		},
		RelativePattern: vi.fn(),
	}
})

vi.mock("../../../utils/path", () => {
	const testPath = require("path")
	return { getWorkspacePath: vi.fn(() => testPath.join(testPath.sep, "test", "workspace")) }
})
vi.mock("fs/promises", () => ({ default: { readFile: vi.fn().mockRejectedValue(new Error("nope")) } }))
vi.mock("../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))
vi.mock("ignore", () => ({
	default: vi.fn().mockReturnValue({ add: vi.fn(), ignores: vi.fn().mockReturnValue(false) }),
}))
vi.mock("@roo-code/telemetry", () => ({ TelemetryService: { instance: { captureEvent: vi.fn() } } }))
vi.mock("../service-factory")

describe("CodeIndexManager - auto-retry on transient connection errors", () => {
	let mockContext: any
	let manager: CodeIndexManager
	const testWorkspacePath = path.join(path.sep, "test", "workspace")

	const stateManager = () => (manager as any)._stateManager
	const fireError = (message: string) => stateManager().setSystemState("Error", message)

	beforeEach(() => {
		vi.useFakeTimers()
		CodeIndexManager.disposeAll()

		const workspaceStateStore: Record<string, any> = {}
		const globalStateStore: Record<string, any> = {}
		mockContext = {
			subscriptions: [],
			workspaceState: {
				get: vi.fn((key: string, def?: any) => workspaceStateStore[key] ?? def),
				update: vi.fn(async (key: string, value: any) => {
					workspaceStateStore[key] = value
				}),
			},
			globalState: {
				get: vi.fn((key: string, def?: any) => globalStateStore[key] ?? def),
				update: vi.fn(async (key: string, value: any) => {
					globalStateStore[key] = value
				}),
			},
			extensionUri: {},
			extensionPath: "/test/ext",
			asAbsolutePath: vi.fn(),
			globalStorageUri: {},
			storageUri: {},
			secrets: {},
		}

		manager = CodeIndexManager.getInstance(mockContext)!

		// The feature is enabled, configured, and workspace-enabled by default.
		vi.spyOn(manager, "isFeatureEnabled", "get").mockReturnValue(true)
		vi.spyOn(manager, "isFeatureConfigured", "get").mockReturnValue(true)
		// A context proxy is required for retries to re-initialize.
		;(manager as any)._contextProxy = {}
	})

	afterEach(() => {
		CodeIndexManager.disposeAll()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("schedules and runs a retry after the initial backoff on a transient error", async () => {
		const recoverSpy = vi.spyOn(manager, "recoverFromError").mockResolvedValue(undefined)
		const initSpy = vi.spyOn(manager, "initialize").mockResolvedValue({ requiresRestart: false })

		fireError("connect ECONNREFUSED 127.0.0.1:8080")

		// Nothing should happen before the backoff elapses.
		expect(initSpy).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(5000)

		expect(recoverSpy).toHaveBeenCalledTimes(1)
		expect(initSpy).toHaveBeenCalledTimes(1)
	})

	it("does NOT retry permanent (non-connection) errors", async () => {
		const initSpy = vi.spyOn(manager, "initialize").mockResolvedValue({ requiresRestart: false })

		fireError("Authentication failed. Please check your API key in the settings.")

		await vi.advanceTimersByTimeAsync(600000)

		expect(initSpy).not.toHaveBeenCalled()
	})

	it("does NOT retry when the feature is disabled", async () => {
		vi.spyOn(manager, "isFeatureEnabled", "get").mockReturnValue(false)
		const initSpy = vi.spyOn(manager, "initialize").mockResolvedValue({ requiresRestart: false })

		fireError("connect ECONNREFUSED 127.0.0.1:8080")
		await vi.advanceTimersByTimeAsync(600000)

		expect(initSpy).not.toHaveBeenCalled()
	})

	it("uses exponential backoff for repeated failures", async () => {
		vi.spyOn(manager, "recoverFromError").mockResolvedValue(undefined)
		let attempt = 0
		const initSpy = vi.spyOn(manager, "initialize").mockImplementation(async () => {
			attempt++
			// Each retry fails with a fresh (changed) connection error so the state manager
			// fires again and the next retry is scheduled.
			fireError(`connect ECONNREFUSED attempt ${attempt}`)
			return { requiresRestart: false }
		})

		fireError("connect ECONNREFUSED initial")

		// First retry at 5s.
		await vi.advanceTimersByTimeAsync(5000)
		expect(initSpy).toHaveBeenCalledTimes(1)

		// Second retry must wait 10s (not 5s).
		await vi.advanceTimersByTimeAsync(9999)
		expect(initSpy).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(initSpy).toHaveBeenCalledTimes(2)

		// Third retry must wait 20s.
		await vi.advanceTimersByTimeAsync(19999)
		expect(initSpy).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(1)
		expect(initSpy).toHaveBeenCalledTimes(3)
	})

	it("cancels a pending retry and resets backoff when indexing succeeds", async () => {
		const initSpy = vi.spyOn(manager, "initialize").mockResolvedValue({ requiresRestart: false })

		fireError("connect ECONNREFUSED 127.0.0.1:8080")
		// Service recovers by some other path.
		stateManager().setSystemState("Indexing", "Indexed 1 / 2 blocks found")
		stateManager().setSystemState("Indexed", "Index up-to-date.")

		await vi.advanceTimersByTimeAsync(600000)
		expect(initSpy).not.toHaveBeenCalled()
	})

	it("cancels a pending retry when indexing is stopped", async () => {
		const initSpy = vi.spyOn(manager, "initialize").mockResolvedValue({ requiresRestart: false })

		fireError("connect ECONNREFUSED 127.0.0.1:8080")
		manager.stopIndexing()

		await vi.advanceTimersByTimeAsync(600000)
		expect(initSpy).not.toHaveBeenCalled()
	})

	it("cancels a pending retry on dispose", async () => {
		const initSpy = vi.spyOn(manager, "initialize").mockResolvedValue({ requiresRestart: false })

		fireError("connect ECONNREFUSED 127.0.0.1:8080")
		manager.dispose()

		await vi.advanceTimersByTimeAsync(600000)
		expect(initSpy).not.toHaveBeenCalled()
	})

	it("caps the backoff at the maximum delay", async () => {
		vi.spyOn(manager, "recoverFromError").mockResolvedValue(undefined)
		let attempt = 0
		const initSpy = vi.spyOn(manager, "initialize").mockImplementation(async () => {
			attempt++
			fireError(`connect ECONNREFUSED attempt ${attempt}`)
			return { requiresRestart: false }
		})

		fireError("connect ECONNREFUSED initial")

		// Drive several retries: 5s,10s,20s,40s,80s,160s,300s(cap),300s...
		const delays = [5000, 10000, 20000, 40000, 80000, 160000, 300000]
		for (let i = 0; i < delays.length; i++) {
			await vi.advanceTimersByTimeAsync(delays[i])
		}
		const callsAfterRamp = initSpy.mock.calls.length

		// After reaching the cap, the next retry should fire after exactly the max delay.
		await vi.advanceTimersByTimeAsync(299999)
		expect(initSpy).toHaveBeenCalledTimes(callsAfterRamp)
		await vi.advanceTimersByTimeAsync(1)
		expect(initSpy).toHaveBeenCalledTimes(callsAfterRamp + 1)
	})
})
