// npx vitest run __tests__/single-open-invariant.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import { ClineProvider } from "../core/webview/ClineProvider"
import { SubagentRegistry } from "../core/webview/SubagentRegistry"
import { PendingEditOperations } from "../core/webview/PendingEditOperations"
import { API } from "../extension/api"
import * as ProfileValidatorMod from "../shared/ProfileValidator"

// Mock Task class used by ClineProvider to avoid heavy startup
vi.mock("../core/task/Task", () => {
	class TaskStub {
		public taskId: string
		public instanceId = "inst"
		public parentTask?: any
		public apiConfiguration: any
		constructor(opts: any) {
			this.taskId = opts.historyItem?.id ?? `task-${Math.random().toString(36).slice(2, 8)}`
			this.parentTask = opts.parentTask
			this.apiConfiguration = opts.apiConfiguration ?? { apiProvider: "anthropic" }
			opts.onCreated?.(this)
		}
		start() {}
		on() {}
		off() {}
		emit() {}
	}
	return { Task: TaskStub }
})

describe("Single-open-task invariant", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it("User-initiated create: closes existing before opening new", async () => {
		// Allow profile
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)

		const clearCurrentTask = vi.fn().mockResolvedValue(undefined)
		const setCurrentTask = vi.fn().mockResolvedValue(undefined)

		const provider = {
			// Simulate an existing current task
			currentTask: { taskId: "existing-1" },
			setValues: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 0 },
				organizationAllowList: "*",
				enableCheckpoints: true,
				checkpointTimeout: 60,
				cloudUserInfo: null,
			}),
			clearCurrentTask,
			leaveCurrentTask: ClineProvider.prototype.leaveCurrentTask,
			switchAwayFromCurrentTask: (ClineProvider.prototype as any).switchAwayFromCurrentTask,
			setCurrentTask,
			subagentRegistry: new SubagentRegistry(() => {}),
			setProviderProfile: vi.fn(),
			getStateToPostToWebview: vi.fn(),
			providerSettingsManager: { getModeConfigId: vi.fn(), listConfig: vi.fn() },
			customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
			taskCreationCallback: vi.fn(),
			contextProxy: {
				extensionUri: {},
				setValue: vi.fn(),
				getValue: vi.fn(),
				setProviderSettings: vi.fn(),
				getProviderSettings: vi.fn(() => ({})),
			},
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).createTask.call(provider, "New task")

		// The previous task leaves the slot; if it still works it keeps running detached.
		expect(clearCurrentTask).toHaveBeenCalledTimes(1)
		expect(clearCurrentTask).toHaveBeenCalledWith({ keepRunning: true })
		expect(setCurrentTask).toHaveBeenCalledTimes(1)
	})

	it("History resume path always closes current before rehydration (non-rehydrating case)", async () => {
		const clearCurrentTask = vi.fn().mockResolvedValue(undefined)
		const setCurrentTask = vi.fn().mockResolvedValue(undefined)
		const updateGlobalState = vi.fn().mockResolvedValue(undefined)

		const provider = {
			getCurrentTask: vi.fn(() => undefined), // ensure not rehydrating
			clearCurrentTask,
			leaveCurrentTask: ClineProvider.prototype.leaveCurrentTask,
			switchAwayFromCurrentTask: (ClineProvider.prototype as any).switchAwayFromCurrentTask,
			setCurrentTask,
			updateGlobalState,
			// The mode and profile restore moved to ModeProfileBinding (CORE-R6 c).
			modeProfiles: { restoreForHistoryItem: vi.fn().mockResolvedValue(undefined) },
			customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
			providerSettingsManager: {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi.fn().mockResolvedValue([]),
			},
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 0 },
				organizationAllowList: { allowAll: true, providers: {} },
				enableCheckpoints: true,
				checkpointTimeout: 60,
				experiments: {},
				cloudUserInfo: null,
				taskSyncEnabled: false,
			}),
			pendingEdits: new PendingEditOperations(),
			context: { extension: { packageJSON: {} }, globalStorageUri: { fsPath: "/tmp" } },
			contextProxy: {
				extensionUri: {},
				getValue: vi.fn(),
				setValue: vi.fn(),
				setProviderSettings: vi.fn(),
				getProviderSettings: vi.fn(() => ({})),
			},
			subagentRegistry: new SubagentRegistry(() => {}),
			newTaskFromHistory: (ClineProvider.prototype as any).newTaskFromHistory,
			postStateToWebview: vi.fn(),
		} as unknown as ClineProvider

		const historyItem = {
			id: "hist-1",
			number: 1,
			ts: Date.now(),
			task: "Task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			workspace: "/tmp",
		}

		const task = await (ClineProvider.prototype as any).createTaskWithHistoryItem.call(provider, historyItem)
		expect(task).toBeTruthy()
		expect(clearCurrentTask).toHaveBeenCalledTimes(1)
		expect(clearCurrentTask).toHaveBeenCalledWith({ keepRunning: true })
		expect(setCurrentTask).toHaveBeenCalledTimes(1)
	})

	it("API startNewTask closes current before new task", async () => {
		const clearCurrentTask = vi.fn().mockResolvedValue(undefined)
		const createTask = vi.fn().mockResolvedValue({ taskId: "ipc-1" })
		const provider = {
			// A real ExtensionContext always has subscriptions; the API registers its
			// panelRegistry.observe disposable there.
			context: { subscriptions: [] } as any,
			clearCurrentTask,
			postStateToWebview: vi.fn(),
			postMessageToWebview: vi.fn(),
			createTask,
			getValues: vi.fn(() => ({})),
			providerSettingsManager: { saveConfig: vi.fn() },
			on: vi.fn((ev: any, cb: any) => {
				if (ev === "taskCreated") {
					// no-op for this test
				}
				return provider
			}),
		} as unknown as ClineProvider

		const output = { appendLine: vi.fn() } as any
		const api = new API(output, provider, false)

		const taskId = await api.startNewTask({
			configuration: {},
			text: "hello",
			images: undefined,
			newTab: false,
		})

		expect(taskId).toBe("ipc-1")
		expect(clearCurrentTask).toHaveBeenCalledTimes(1)
		expect(createTask).toHaveBeenCalled()
	})
})
