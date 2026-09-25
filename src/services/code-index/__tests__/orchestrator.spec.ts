import { describe, it, expect, beforeEach, vi } from "vitest"
import { CodeIndexOrchestrator } from "../orchestrator"

// Mock vscode workspace so startIndexing passes workspace check
vi.mock("vscode", () => {
	const path = require("path")
	const testWorkspacePath = path.join(path.sep, "test", "workspace")
	return {
		window: {
			activeTextEditor: null,
		},
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: testWorkspacePath },
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
		},
		RelativePattern: vi.fn().mockImplementation((base: string, pattern: string) => ({ base, pattern })),
	}
})

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Mock i18n translator used in orchestrator messages
vi.mock("../../../i18n", () => ({
	t: (key: string, params?: any) => {
		if (key === "embeddings:orchestrator.failedDuringInitialScan" && params?.errorMessage) {
			return `Failed during initial scan: ${params.errorMessage}`
		}
		return key
	},
}))

describe("CodeIndexOrchestrator - error path cleanup gating", () => {
	const workspacePath = "/test/workspace"

	let configManager: any
	let stateManager: any
	let cacheManager: any
	let vectorStore: any
	let scanner: any
	let fileWatcher: any

	beforeEach(() => {
		vi.clearAllMocks()

		configManager = {
			isFeatureConfigured: true,
		}

		// Minimal state manager that tracks state transitions
		let currentState = "Standby"
		stateManager = {
			get state() {
				return currentState
			},
			setSystemState: vi.fn().mockImplementation((state: string, _msg: string) => {
				currentState = state
			}),
			reportFileQueueProgress: vi.fn(),
			reportBlockIndexingProgress: vi.fn(),
		}

		cacheManager = {
			clearCacheFile: vi.fn().mockResolvedValue(undefined),
			flush: vi.fn().mockResolvedValue(undefined),
		}

		vectorStore = {
			initialize: vi.fn(),
			hasIndexedData: vi.fn(),
			markIndexingIncomplete: vi.fn(),
			markIndexingComplete: vi.fn(),
			clearCollection: vi.fn().mockResolvedValue(undefined),
		}

		scanner = {
			scanDirectory: vi.fn(),
		}

		fileWatcher = {
			initialize: vi.fn().mockResolvedValue(undefined),
			onDidStartBatchProcessing: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onBatchProgressUpdate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidFinishBatchProcessing: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			stop: vi.fn(),
			dispose: vi.fn(),
		}
	})

	it("should not call clearCollection() or clear cache when initialize() fails (indexing not started)", async () => {
		// Arrange: fail at initialize()
		vectorStore.initialize.mockRejectedValue(new Error("Qdrant unreachable"))

		const orchestrator = new CodeIndexOrchestrator(
			configManager,
			stateManager,
			workspacePath,
			cacheManager,
			vectorStore,
			scanner,
			fileWatcher,
		)

		// Act
		await orchestrator.startIndexing()

		// Assert
		expect(vectorStore.clearCollection).not.toHaveBeenCalled()
		expect(cacheManager.clearCacheFile).not.toHaveBeenCalled()

		// Error state should be set
		expect(stateManager.setSystemState).toHaveBeenCalled()
		const lastCall = stateManager.setSystemState.mock.calls[stateManager.setSystemState.mock.calls.length - 1]
		expect(lastCall[0]).toBe("Error")
	})

	it("should call clearCollection() and clear cache when an error occurs after initialize() succeeds (indexing started)", async () => {
		// Arrange: initialize succeeds; fail soon after to enter error path with indexingStarted=true
		vectorStore.initialize.mockResolvedValue(false) // existing collection
		vectorStore.hasIndexedData.mockResolvedValue(false) // force full scan path
		vectorStore.markIndexingIncomplete.mockRejectedValue(new Error("mark incomplete failure"))

		const orchestrator = new CodeIndexOrchestrator(
			configManager,
			stateManager,
			workspacePath,
			cacheManager,
			vectorStore,
			scanner,
			fileWatcher,
		)

		// Act
		await orchestrator.startIndexing()

		// Assert: cleanup gated behind indexingStarted should have happened
		expect(vectorStore.clearCollection).toHaveBeenCalledTimes(1)
		expect(cacheManager.clearCacheFile).toHaveBeenCalledTimes(1)

		// Error state should be set
		expect(stateManager.setSystemState).toHaveBeenCalled()
		const lastCall = stateManager.setSystemState.mock.calls[stateManager.setSystemState.mock.calls.length - 1]
		expect(lastCall[0]).toBe("Error")
	})
})

describe("CodeIndexOrchestrator - stopIndexing", () => {
	const workspacePath = "/test/workspace"

	let configManager: any
	let stateManager: any
	let cacheManager: any
	let vectorStore: any
	let scanner: any
	let fileWatcher: any

	beforeEach(() => {
		vi.clearAllMocks()

		configManager = {
			isFeatureConfigured: true,
		}

		let currentState = "Standby"
		stateManager = {
			get state() {
				return currentState
			},
			setSystemState: vi.fn().mockImplementation((state: string, _msg: string) => {
				currentState = state
			}),
			reportFileQueueProgress: vi.fn(),
			reportBlockIndexingProgress: vi.fn(),
		}

		cacheManager = {
			clearCacheFile: vi.fn().mockResolvedValue(undefined),
			flush: vi.fn().mockResolvedValue(undefined),
		}

		vectorStore = {
			initialize: vi.fn().mockResolvedValue(false),
			hasIndexedData: vi.fn().mockResolvedValue(false),
			markIndexingIncomplete: vi.fn().mockResolvedValue(undefined),
			markIndexingComplete: vi.fn().mockResolvedValue(undefined),
			clearCollection: vi.fn().mockResolvedValue(undefined),
		}

		scanner = {
			scanDirectory: vi.fn(),
		}

		fileWatcher = {
			initialize: vi.fn().mockResolvedValue(undefined),
			onDidStartBatchProcessing: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onBatchProgressUpdate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidFinishBatchProcessing: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			stop: vi.fn(),
			dispose: vi.fn(),
		}
	})

	it("should abort indexing when stopIndexing() is called", async () => {
		// Make scanner hang until aborted
		scanner.scanDirectory.mockImplementation(
			async (_dir: string, _onError?: any, _onBlocksIndexed?: any, _onFileParsed?: any, signal?: AbortSignal) => {
				// Wait for abort signal
				await new Promise<void>((resolve) => {
					if (signal?.aborted) {
						resolve()
						return
					}
					signal?.addEventListener("abort", () => resolve())
				})
				return { stats: { processed: 0, skipped: 0 }, totalBlockCount: 0 }
			},
		)

		const orchestrator = new CodeIndexOrchestrator(
			configManager,
			stateManager,
			workspacePath,
			cacheManager,
			vectorStore,
			scanner,
			fileWatcher,
		)

		// Start indexing (async, don't await)
		const indexingPromise = orchestrator.startIndexing()

		// Give it a tick to begin
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Stop indexing
		orchestrator.stopIndexing()

		// Wait for indexing to complete
		await indexingPromise

		// State should be Standby (not Error)
		const setStateCalls = stateManager.setSystemState.mock.calls
		const lastCall = setStateCalls[setStateCalls.length - 1]
		expect(lastCall[0]).toBe("Standby")
	})

	it("should set state to Standby after abort, not Error", async () => {
		// Make scanner throw AbortError when signal is aborted
		scanner.scanDirectory.mockImplementation(
			async (_dir: string, _onError?: any, _onBlocksIndexed?: any, _onFileParsed?: any, signal?: AbortSignal) => {
				await new Promise<void>((resolve) => {
					if (signal?.aborted) {
						resolve()
						return
					}
					signal?.addEventListener("abort", () => resolve())
				})
				throw new DOMException("Indexing aborted", "AbortError")
			},
		)

		const orchestrator = new CodeIndexOrchestrator(
			configManager,
			stateManager,
			workspacePath,
			cacheManager,
			vectorStore,
			scanner,
			fileWatcher,
		)

		const indexingPromise = orchestrator.startIndexing()
		await new Promise((resolve) => setTimeout(resolve, 10))

		orchestrator.stopIndexing()
		await indexingPromise

		// Should NOT have set Error state — abort is handled gracefully
		const errorCalls = stateManager.setSystemState.mock.calls.filter((call: any[]) => call[0] === "Error")
		expect(errorCalls).toHaveLength(0)

		// Should NOT have cleared collection on abort
		expect(vectorStore.clearCollection).not.toHaveBeenCalled()
	})

	it("should preserve partial index data after stop", async () => {
		scanner.scanDirectory.mockImplementation(
			async (_dir: string, _onError?: any, _onBlocksIndexed?: any, _onFileParsed?: any, signal?: AbortSignal) => {
				await new Promise<void>((resolve) => {
					if (signal?.aborted) {
						resolve()
						return
					}
					signal?.addEventListener("abort", () => resolve())
				})
				return { stats: { processed: 5, skipped: 0 }, totalBlockCount: 5 }
			},
		)

		const orchestrator = new CodeIndexOrchestrator(
			configManager,
			stateManager,
			workspacePath,
			cacheManager,
			vectorStore,
			scanner,
			fileWatcher,
		)

		const indexingPromise = orchestrator.startIndexing()
		await new Promise((resolve) => setTimeout(resolve, 10))

		orchestrator.stopIndexing()
		await indexingPromise

		// Cache should NOT be cleared on user-initiated stop
		expect(cacheManager.clearCacheFile).not.toHaveBeenCalled()
		// Collection should NOT be cleared on user-initiated stop
		expect(vectorStore.clearCollection).not.toHaveBeenCalled()
	})
})

describe("CodeIndexOrchestrator - incremental scan batch errors (DEF-C17 drift 3)", () => {
	const workspacePath = "/test/workspace"

	let configManager: any
	let stateManager: any
	let cacheManager: any
	let vectorStore: any
	let scanner: any
	let fileWatcher: any

	beforeEach(() => {
		vi.clearAllMocks()

		configManager = { isFeatureConfigured: true }

		let currentState = "Standby"
		stateManager = {
			get state() {
				return currentState
			},
			setSystemState: vi.fn().mockImplementation((state: string, _msg: string) => {
				currentState = state
			}),
			reportFileQueueProgress: vi.fn(),
			reportBlockIndexingProgress: vi.fn(),
		}

		cacheManager = {
			clearCacheFile: vi.fn().mockResolvedValue(undefined),
			flush: vi.fn().mockResolvedValue(undefined),
		}

		// An existing, complete collection: startIndexing takes the incremental path.
		vectorStore = {
			initialize: vi.fn().mockResolvedValue(false),
			hasIndexedData: vi.fn().mockResolvedValue(true),
			markIndexingIncomplete: vi.fn().mockResolvedValue(undefined),
			markIndexingComplete: vi.fn().mockResolvedValue(undefined),
			clearCollection: vi.fn().mockResolvedValue(undefined),
		}

		scanner = { scanDirectory: vi.fn() }

		fileWatcher = {
			initialize: vi.fn().mockResolvedValue(undefined),
			onDidStartBatchProcessing: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onBatchProgressUpdate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidFinishBatchProcessing: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			stop: vi.fn(),
			dispose: vi.fn(),
		}
	})

	const makeOrchestrator = () =>
		new CodeIndexOrchestrator(
			configManager,
			stateManager,
			workspacePath,
			cacheManager,
			vectorStore,
			scanner,
			fileWatcher,
		)

	/** Scanner stub: parses `found` blocks, indexes `indexed` of them and reports `errors` batch errors. */
	const scanReporting = (found: number, indexed: number, errors: string[]) =>
		scanner.scanDirectory.mockImplementation(
			async (
				_dir: string,
				onError?: (e: Error) => void,
				onBlocksIndexed?: (n: number) => void,
				onFileParsed?: (n: number) => void,
			) => {
				onFileParsed?.(found)
				if (indexed > 0) onBlocksIndexed?.(indexed)
				for (const message of errors) onError?.(new Error(message))
				return { stats: { processed: 1, skipped: 0 }, totalBlockCount: found }
			},
		)

	it("reports Error, not Indexed, when every batch of the incremental scan failed", async () => {
		scanReporting(40, 0, ["Failed to process batch after 3 attempts: 400 Bad Request"])

		await makeOrchestrator().startIndexing()

		const lastCall = stateManager.setSystemState.mock.calls.at(-1)
		expect(lastCall[0]).toBe("Error")
		expect(lastCall[1]).toContain("400 Bad Request")
		expect(vectorStore.markIndexingComplete).not.toHaveBeenCalled()
	})

	it("keeps the existing index and cache when the incremental scan fails", async () => {
		scanReporting(40, 0, ["Failed to process batch after 3 attempts: connect ECONNREFUSED 127.0.0.1:11111"])

		await makeOrchestrator().startIndexing()

		// The collection was complete before this scan; failed files keep their old cache hash,
		// so the next scan retries them. Wiping everything would turn a hiccup into a full reindex.
		expect(vectorStore.clearCollection).not.toHaveBeenCalled()
		expect(cacheManager.clearCacheFile).not.toHaveBeenCalled()
		expect(cacheManager.flush).toHaveBeenCalled()
	})

	it("reports Error when more than 10% of the incremental blocks failed, like the full scan", async () => {
		scanReporting(100, 50, ["Failed to process batch after 3 attempts: timeout"])

		await makeOrchestrator().startIndexing()

		expect(stateManager.setSystemState.mock.calls.at(-1)[0]).toBe("Error")
		expect(vectorStore.markIndexingComplete).not.toHaveBeenCalled()
	})

	it("stays Indexed when only a small share of the incremental blocks failed, like the full scan", async () => {
		scanReporting(100, 95, ["Failed to process batch after 3 attempts: timeout"])

		await makeOrchestrator().startIndexing()

		expect(stateManager.setSystemState.mock.calls.at(-1)[0]).toBe("Indexed")
		expect(vectorStore.markIndexingComplete).toHaveBeenCalled()
	})
})
