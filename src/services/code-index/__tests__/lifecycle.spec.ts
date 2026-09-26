// npx vitest services/code-index/__tests__/lifecycle.spec.ts
//
// Lifecycle of the code-index watcher chain (SVC-10): a real CodeIndexOrchestrator driving a real
// FileWatcher. The vscode mock below reproduces the two VS Code behaviors that matter here:
// an EventEmitter that is dead after dispose() (new subscriptions are ignored, fire() reaches
// nobody), and one FileSystemWatcher object per createFileSystemWatcher() call.

import * as path from "path"
import * as vscode from "vscode"

import { CodeIndexOrchestrator } from "../orchestrator"
import { FileWatcher } from "../processors/file-watcher"

vi.mock("vscode", () => {
	class FakeEventEmitter<T> {
		private listeners: Array<(value: T) => void> = []
		private disposed = false

		public readonly event = (listener: (value: T) => void) => {
			// Same as VS Code's Emitter: a disposed emitter hands out a no-op subscription.
			if (this.disposed) {
				return { dispose: () => {} }
			}
			this.listeners.push(listener)
			return {
				dispose: () => {
					this.listeners = this.listeners.filter((l) => l !== listener)
				},
			}
		}

		public fire(value: T) {
			for (const listener of [...this.listeners]) {
				listener(value)
			}
		}

		public dispose() {
			this.disposed = true
			this.listeners = []
		}
	}

	const nodePath = require("path")
	return {
		EventEmitter: FakeEventEmitter,
		RelativePattern: vi.fn().mockImplementation(function (base: string, pattern: string) {
			return { base, pattern }
		}),
		workspace: {
			workspaceFolders: [{ uri: { fsPath: nodePath.resolve("/test/workspace") }, name: "test", index: 0 }],
			createFileSystemWatcher: vi.fn(),
			getConfiguration: vi.fn().mockReturnValue({ get: (_key: string, fallback: unknown) => fallback }),
		},
	}
})

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() } },
}))

vi.mock("../../../i18n", () => ({ t: (key: string) => key }))

vi.mock("../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: vi.fn().mockImplementation(function () {
		return {
			validateAccess: vi.fn().mockReturnValue(true),
			dispose: vi.fn(),
		}
	}),
}))

vi.mock("../processors/parser", () => ({ codeParser: { parseFile: vi.fn().mockResolvedValue([]) } }))

type FakeFsWatcher = {
	fireDelete: (fsPath: string) => void
	dispose: ReturnType<typeof vi.fn>
	listenerDisposes: Array<ReturnType<typeof vi.fn>>
}

describe("code-index watcher lifecycle", () => {
	const workspacePath = path.resolve("/test/workspace")
	let fsWatchers: FakeFsWatcher[]
	let stateManager: any
	let fileWatcher: FileWatcher
	let orchestrator: CodeIndexOrchestrator

	beforeEach(() => {
		vi.useFakeTimers()
		fsWatchers = []
		vi.mocked(vscode.workspace.createFileSystemWatcher).mockImplementation(() => {
			// Like a real FileSystemWatcher: no events once it or the listener is disposed.
			let onDelete: ((uri: { fsPath: string }) => void) | undefined
			let watcherDisposed = false
			const listenerDisposes: Array<ReturnType<typeof vi.fn>> = []
			const listen = (store?: (h: any) => void) =>
				vi.fn().mockImplementation((handler: any) => {
					store?.(handler)
					const dispose = vi.fn(() => store?.(undefined))
					listenerDisposes.push(dispose)
					return { dispose }
				})
			const record: FakeFsWatcher = {
				fireDelete: (fsPath) => {
					if (!watcherDisposed) onDelete?.({ fsPath })
				},
				dispose: vi.fn(() => {
					watcherDisposed = true
				}),
				listenerDisposes,
			}
			fsWatchers.push(record)
			return {
				onDidCreate: listen(),
				onDidChange: listen(),
				onDidDelete: listen((h) => (onDelete = h)),
				dispose: record.dispose,
			} as any
		})

		let currentState = "Standby"
		stateManager = {
			get state() {
				return currentState
			},
			setSystemState: vi.fn().mockImplementation((state: string) => {
				currentState = state
			}),
			reportFileQueueProgress: vi.fn(),
			reportBlockIndexingProgress: vi.fn(),
		}

		const cacheManager: any = {
			getHash: vi.fn(),
			updateHash: vi.fn(),
			deleteHash: vi.fn(),
			clearCacheFile: vi.fn().mockResolvedValue(undefined),
			flush: vi.fn().mockResolvedValue(undefined),
		}
		const vectorStore: any = {
			initialize: vi.fn().mockResolvedValue(false),
			hasIndexedData: vi.fn().mockResolvedValue(false),
			markIndexingIncomplete: vi.fn().mockResolvedValue(undefined),
			markIndexingComplete: vi.fn().mockResolvedValue(undefined),
			clearCollection: vi.fn().mockResolvedValue(undefined),
			deletePointsByMultipleFilePaths: vi.fn().mockResolvedValue(undefined),
			upsertPoints: vi.fn().mockResolvedValue(undefined),
		}
		const scanner: any = {
			scanDirectory: vi.fn().mockResolvedValue({ stats: { processed: 0, skipped: 0 }, totalBlockCount: 0 }),
		}
		const embedder: any = { createEmbeddings: vi.fn() }
		const ignoreInstance: any = { ignores: vi.fn().mockReturnValue(false) }

		fileWatcher = new FileWatcher(
			workspacePath,
			{ subscriptions: [] } as any,
			cacheManager,
			embedder,
			vectorStore,
			ignoreInstance,
			undefined,
			60,
		)
		orchestrator = new CodeIndexOrchestrator(
			{ isFeatureConfigured: true } as any,
			stateManager,
			workspacePath,
			cacheManager,
			vectorStore,
			scanner,
			fileWatcher,
		)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	/** Deletes one file through the newest fs watcher and lets the debounced batch run. */
	async function deleteOneFile(name: string) {
		fsWatchers[fsWatchers.length - 1].fireDelete(path.join(workspacePath, name))
		await vi.advanceTimersByTimeAsync(1000)
	}

	/** The orchestrator reports (0 of 1) exactly once per one-file batch it hears about. */
	function batchStartsSeen() {
		return stateManager.reportFileQueueProgress.mock.calls.filter(
			([processed, total]: [number, number]) => processed === 0 && total === 1,
		).length
	}

	it("delivers batch progress to the orchestrator after Stop then Start", async () => {
		await orchestrator.startIndexing()
		await deleteOneFile("a.ts")
		expect(batchStartsSeen()).toBe(1)

		orchestrator.stopIndexing()
		await orchestrator.startIndexing()
		expect(stateManager.state).toBe("Indexed")

		await deleteOneFile("b.ts")
		// Before the fix, stopWatcher() disposed the FileWatcher's emitters, so the restarted
		// orchestrator subscribed to dead emitters and never heard about this batch.
		expect(batchStartsSeen()).toBe(2)
		expect(stateManager.setSystemState).toHaveBeenLastCalledWith("Indexed", expect.any(String))
	})

	it("starting indexing twice keeps one fs watcher and one set of subscriptions", async () => {
		await orchestrator.startIndexing()
		await orchestrator.startIndexing()

		expect(fsWatchers).toHaveLength(2)
		expect(fsWatchers[0].dispose).toHaveBeenCalled()
		for (const d of fsWatchers[0].listenerDisposes) {
			expect(d).toHaveBeenCalled()
		}

		// Events of the replaced fs watcher must not produce a batch any more.
		fsWatchers[0].fireDelete(path.join(workspacePath, "stale.ts"))
		await vi.advanceTimersByTimeAsync(1000)
		expect(batchStartsSeen()).toBe(0)

		// One batch is reported once, not once per startIndexing() call.
		await deleteOneFile("c.ts")
		expect(batchStartsSeen()).toBe(1)
	})

	it("FileWatcher.initialize twice disposes the first fs watcher", async () => {
		await fileWatcher.initialize()
		await fileWatcher.initialize()

		expect(fsWatchers).toHaveLength(2)
		expect(fsWatchers[0].dispose).toHaveBeenCalledTimes(1)
		expect(fsWatchers[1].dispose).not.toHaveBeenCalled()
	})

	it("dispose() is final: the orchestrator disposes the FileWatcher and its fs watcher", async () => {
		await orchestrator.startIndexing()
		const subscribed = vi.fn()

		orchestrator.dispose()
		expect(fsWatchers[0].dispose).toHaveBeenCalled()

		// The emitters are gone for good after a final dispose.
		fileWatcher.onBatchProgressUpdate(subscribed)
		fsWatchers[0].fireDelete(path.join(workspacePath, "d.ts"))
		await vi.advanceTimersByTimeAsync(1000)
		expect(subscribed).not.toHaveBeenCalled()
	})

	it("a disposed orchestrator does not write state when its aborted scan unwinds", async () => {
		let releaseScan!: () => void
		const scanner: any = {
			scanDirectory: vi.fn(
				(_d: string, _e: any, _b: any, _f: any, signal: AbortSignal) =>
					new Promise((resolve) => {
						releaseScan = () => resolve({ stats: { processed: 0, skipped: 0 }, totalBlockCount: 0 })
						signal.addEventListener("abort", () => releaseScan())
					}),
			),
		}
		const old = new CodeIndexOrchestrator(
			{ isFeatureConfigured: true } as any,
			stateManager,
			workspacePath,
			{ flush: vi.fn().mockResolvedValue(undefined), clearCacheFile: vi.fn() } as any,
			{
				initialize: vi.fn().mockResolvedValue(false),
				hasIndexedData: vi.fn().mockResolvedValue(false),
				markIndexingIncomplete: vi.fn().mockResolvedValue(undefined),
			} as any,
			scanner,
			fileWatcher,
		)
		const running = old.startIndexing()
		await vi.advanceTimersByTimeAsync(0)
		expect(scanner.scanDirectory).toHaveBeenCalled()

		// The manager drops this orchestrator (settings change, recovery) and a new one takes over.
		old.dispose()
		stateManager.setSystemState("Indexing", "new orchestrator scanning")
		const writesBefore = stateManager.setSystemState.mock.calls.length
		await running

		// The unwinding scan must not overwrite the new orchestrator's state with "Standby".
		expect(stateManager.setSystemState.mock.calls.length).toBe(writesBefore)
		expect(stateManager.state).toBe("Indexing")
	})
})
