// npx vitest run core/task/__tests__/Task.condense-handler-invalidation.spec.ts
// Run from the `src` workspace: cd src && npx vitest run core/task/__tests__/Task.condense-handler-invalidation.spec.ts

// Regression + feature test for the background-model-for-compaction feature.
//
// Task.condenseApiHandler is a sync passthrough getter; Task.getCondenseApiHandler()
// is the async resolver that reads `autoCondenseContextApiConfigId` from the
// provider, loads the profile via `providerSettingsManager.getProfile`, builds a
// background handler, and caches a BackgroundModelHandler wrapping it with a
// fallback to `this.api`. `updateApiConfiguration` must invalidate the cache so
// a mid-task profile switch rebuilds against the new handler. A stale/missing
// profile id must yield a passthrough wrapper (background === undefined) and
// never throw.

import * as vscode from "vscode"

import type { ProviderSettings } from "@roo-code/types"
import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { BackgroundModelHandler } from "../../../api/BackgroundModelHandler"

// The sync `condenseApiHandler` getter on Task is private to force external
// callers through the async `getCondenseApiHandler()` resolver (M1 hardening).
// These tests still need to assert the private getter's passthrough / caching
// behavior, so we cast through `unknown` to a narrow view that re-exposes it.
// This cast lives only in the test file; production code cannot reach the
// getter (it is private at the type level).
type TaskWithSyncCondenseGetter = {
	readonly condenseApiHandler: BackgroundModelHandler
}
const syncCondense = (task: Task) => (task as unknown as TaskWithSyncCondenseGetter).condenseApiHandler

// Track every ApiHandler we hand out from buildApiHandler so the test can
// distinguish the foreground handler from the background handler and verify
// which one the wrapper falls back to.
const { foregroundHandler, backgroundHandler, buildCallCount, resetBuildTracking } = vi.hoisted(() => {
	const fg = {
		createMessage: vi.fn(),
		getModel: vi.fn().mockReturnValue({ id: "fg-model", info: {} }),
		countTokens: vi.fn().mockResolvedValue(0),
	}
	const bg = {
		createMessage: vi.fn(),
		getModel: vi.fn().mockReturnValue({ id: "bg-model", info: {} }),
		countTokens: vi.fn().mockResolvedValue(0),
		cancelRequest: vi.fn(),
	}
	return {
		foregroundHandler: fg,
		backgroundHandler: bg,
		buildCallCount: { value: 0 },
		resetBuildTracking: () => {
			buildCallCount.value = 0
		},
	}
})

vi.mock("../../../api", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	return {
		...actual,
		// First call = Task constructor (foreground). Subsequent calls = background
		// profile resolution via resolveBackgroundCondenseHandler.
		buildApiHandler: vi.fn(() => {
			buildCallCount.value++
			return buildCallCount.value === 1 ? foregroundHandler : backgroundHandler
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
			createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
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
			workspaceFolders: [{ uri: { fsPath: "/mock/workspace/path" }, name: "mock-workspace", index: 0 }],
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
			fs: { stat: vi.fn().mockResolvedValue({ type: 1 }) },
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
		},
		env: { uriScheme: "vscode", language: "en" },
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: { from: vi.fn() },
		TabInputText: vi.fn(),
		version: "1.85.0",
	}
})

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("p-wait-for", () => ({ default: vi.fn().mockImplementation(async () => Promise.resolve()) }))

vi.mock("delay", () => ({ __esModule: true, default: vi.fn().mockResolvedValue(undefined) }))

vi.mock("uuid", async (importOriginal) => {
	const actual = await importOriginal<typeof import("uuid")>()
	return { ...actual, v7: vi.fn(() => "00000000-0000-7000-8000-000000000000") }
})

vi.mock("execa", () => ({ execa: vi.fn() }))

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

// Keep memory enabled off so the MemoryCoordinator getter does not interfere.
vi.mock("../../memory/paths", () => ({ isAutoMemoryEnabled: vi.fn().mockReturnValue(false) }))

describe("Task — condenseApiHandler (background model + fallback)", () => {
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

	function makeProvider(opts: {
		condenseProfileId?: string
		getProfileImpl?: (args: { id: string }) => Promise<ProviderSettings>
	}): ClineProvider {
		const getProfileImpl =
			opts.getProfileImpl ??
			(async () => ({ apiProvider: "openai", apiModelId: "gpt-4o", apiKey: "bg-key" }) as ProviderSettings)
		return {
			context: { globalStorageUri: { fsPath: "/test/storage" } },
			getState: vi.fn().mockResolvedValue({}),
			getValue: vi.fn((key: string) =>
				key === "autoCondenseContextApiConfigId" ? opts.condenseProfileId : undefined,
			),
			log: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
			providerSettingsManager: {
				getProfile: vi.fn((args: { id: string }) => getProfileImpl(args)),
			},
		} as unknown as ClineProvider
	}

	beforeEach(() => {
		resetBuildTracking()
	})

	it("sync getter returns a passthrough wrapper when no background is resolved yet", () => {
		const provider = makeProvider({ condenseProfileId: undefined })
		const task = new Task({ provider, apiConfiguration: apiConfig, task: "test", startTask: false })
		const handler = syncCondense(task)
		expect(handler).toBeInstanceOf(BackgroundModelHandler)
		expect((handler as BackgroundModelHandler).background).toBeUndefined()
		expect((handler as BackgroundModelHandler).fallback).toBe(foregroundHandler)
	})

	it("async resolver builds a wrapper with background + fallback when a profile id is configured", async () => {
		const provider = makeProvider({ condenseProfileId: "profile-bg" })
		const task = new Task({ provider, apiConfiguration: apiConfig, task: "test", startTask: false })
		const handler = await task.getCondenseApiHandler()
		expect(handler).toBeInstanceOf(BackgroundModelHandler)
		expect((handler as BackgroundModelHandler).background).toBe(backgroundHandler)
		expect((handler as BackgroundModelHandler).fallback).toBe(foregroundHandler)
	})

	it("async resolver returns a passthrough wrapper when no profile id is configured", async () => {
		const provider = makeProvider({ condenseProfileId: undefined })
		const task = new Task({ provider, apiConfiguration: apiConfig, task: "test", startTask: false })
		const handler = await task.getCondenseApiHandler()
		expect((handler as BackgroundModelHandler).background).toBeUndefined()
		expect((handler as BackgroundModelHandler).fallback).toBe(foregroundHandler)
	})

	it("async resolver returns a passthrough wrapper (no throw) when the profile id is stale", async () => {
		const provider = makeProvider({
			condenseProfileId: "deleted-profile",
			getProfileImpl: async () => {
				throw new Error("profile not found")
			},
		})
		const task = new Task({ provider, apiConfiguration: apiConfig, task: "test", startTask: false })
		const handler = await task.getCondenseApiHandler()
		expect(handler).toBeInstanceOf(BackgroundModelHandler)
		// Stale id => background undefined => passthrough, no throw.
		expect((handler as BackgroundModelHandler).background).toBeUndefined()
		expect((handler as BackgroundModelHandler).fallback).toBe(foregroundHandler)
	})

	it("caches the resolved handler across sync getter and async resolver calls", async () => {
		const provider = makeProvider({ condenseProfileId: "profile-bg" })
		const task = new Task({ provider, apiConfiguration: apiConfig, task: "test", startTask: false })
		const resolved = await task.getCondenseApiHandler()
		// Sync getter now returns the cached resolved wrapper (not a passthrough).
		expect(syncCondense(task)).toBe(resolved)
	})

	it("updateApiConfiguration invalidates the cached condense handler", async () => {
		const provider = makeProvider({ condenseProfileId: undefined })
		const task = new Task({ provider, apiConfiguration: apiConfig, task: "test", startTask: false })

		// First access: passthrough wrapper bound to the foreground handler A.
		const before = syncCondense(task)
		expect((before as BackgroundModelHandler).fallback).toBe(foregroundHandler)

		// Switch the API configuration mid-task (rebuilds this.api → handler B).
		// buildCallCount is now 2, so the next build returns backgroundHandler,
		// but since no profile id is configured the resolver returns a passthrough
		// whose fallback is the newly-built this.api (backgroundHandler).
		task.updateApiConfiguration(apiConfigB)

		const after = syncCondense(task)
		expect(after).not.toBe(before)
		// The new passthrough wrapper's fallback is the rebuilt this.api.
		expect((after as BackgroundModelHandler).fallback).toBe(backgroundHandler)
	})

	it("changing autoCondenseContextApiConfigId rebuilds on next resolve — no updateApiConfiguration needed", async () => {
		// Tasks that never receive updateApiConfiguration (paused parents,
		// background subagents) must still pick up a changed setting: the cache
		// is keyed by the config id it was built for.
		let configId: string | undefined = undefined
		const provider = makeProvider({})
		;(provider.getValue as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
			key === "autoCondenseContextApiConfigId" ? configId : undefined,
		)
		const task = new Task({ provider, apiConfiguration: apiConfig, task: "test", startTask: false })

		// First resolve: no id configured → passthrough, and it is cached.
		const before = await task.getCondenseApiHandler()
		expect((before as BackgroundModelHandler).background).toBeUndefined()
		expect(await task.getCondenseApiHandler()).toBe(before)

		// User selects a compaction profile in Settings (global state changes;
		// this task gets no updateApiConfiguration call).
		configId = "profile-bg"
		const after = await task.getCondenseApiHandler()
		expect(after).not.toBe(before)
		expect((after as BackgroundModelHandler).background).toBe(backgroundHandler)

		// And it re-caches under the new id.
		expect(await task.getCondenseApiHandler()).toBe(after)

		// Clearing the setting drops back to a passthrough.
		configId = undefined
		const cleared = await task.getCondenseApiHandler()
		expect(cleared).not.toBe(after)
		expect((cleared as BackgroundModelHandler).background).toBeUndefined()
	})

	it("cancelCondenseRequest severs the background handler's in-flight request", async () => {
		const provider = makeProvider({ condenseProfileId: "profile-bg" })
		const task = new Task({ provider, apiConfiguration: apiConfig, task: "test", startTask: false })

		// Before any resolve: no cached handler — must be a no-op, not a throw.
		expect(() => task.cancelCondenseRequest(true)).not.toThrow()

		await task.getCondenseApiHandler()
		task.cancelCondenseRequest(true)
		// Only the background handler is severed here; the fallback IS this.api,
		// which TaskLifecycle.cancelCurrentRequest cancels itself.
		expect(backgroundHandler.cancelRequest).toHaveBeenCalledWith(true)
	})
})
