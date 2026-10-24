// pnpm --filter tumble-code test core/webview/__tests__/ClineProvider.apiHandlerRebuild.spec.ts

import { TelemetryService } from "@tumble-code/telemetry"

import { Task, TaskOptions } from "../../task/Task"
import { ClineProvider } from "../ClineProvider"
import { createMockContext, createMockWebviewView, createTestProvider } from "./helpers/providerHarness"

// Mock setup
vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
}))

// The fs/promises mock above has no stat/open/rename, so the real atomic write
// (used by CustomModesManager since #728) cannot run here.
vi.mock("@tumble-code/core/fs", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tumble-code/core/fs")>()),
	writeFileAtomic: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../utils/storage", () => ({
	getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => Promise.resolve(defaultPath)),
	getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
	getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	getGlobalStoragePath: vi.fn().mockResolvedValue("/test/storage/path"),
}))

vi.mock("p-wait-for", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("delay", () => {
	const delayFn = (_ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return { default: delayFn }
})

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn(),
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => {
	return {
		default: vi.fn().mockImplementation(function () {
			return {
				initializeFilePaths: vi.fn(),
				dispose: vi.fn(),
			}
		}),
	}
})

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation(function (options) {
		const mockTask = {
			api: undefined,
			abortTask: vi.fn(),
			handleWebviewAskResponse: vi.fn(),
			clineMessages: [],
			apiConversationHistory: [],
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
			taskId: options?.historyItem?.id || "test-task-id",
			emit: vi.fn(),
			updateApiConfiguration: vi.fn(),
		}
		// Define apiConfiguration as a property so tests can read it
		Object.defineProperty(mockTask, "apiConfiguration", {
			value: options?.apiConfiguration || { apiProvider: "openrouter", openRouterModelId: "openai/gpt-4" },
			writable: true,
			configurable: true,
		})
		return mockTask
	}),
}))

vi.mock("@tumble-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(true),
		get instance() {
			return {
				isAuthenticated: vi.fn().mockReturnValue(false),
				on: vi.fn(),
				off: vi.fn(),
			}
		},
	},
	getTumbleCodeApiUrl: vi.fn().mockReturnValue("http://localhost:8080"),
}))

describe("ClineProvider - the current task gets the provider profile", () => {
	let provider: ClineProvider
	let defaultTaskOptions: TaskOptions

	beforeEach(async () => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		provider = createTestProvider(createMockContext({ mode: "code", currentApiConfigName: "test-config" }))
		const profile = {
			name: "test-config",
			id: "test-id",
			apiProvider: "openrouter",
			openRouterModelId: "openai/gpt-4",
		}
		;(provider as any).providerSettingsManager = {
			saveConfig: vi.fn().mockResolvedValue("test-id"),
			listConfig: vi.fn().mockResolvedValue([profile]),
			setModeConfig: vi.fn(),
			activateProfile: vi.fn().mockResolvedValue(profile),
			getProfile: vi.fn().mockResolvedValue(profile),
		}

		defaultTaskOptions = {
			provider,
			apiConfiguration: { apiProvider: "openrouter", openRouterModelId: "openai/gpt-4" },
		}

		await provider.resolveWebviewView(createMockWebviewView())
	})

	const openTask = async () => {
		const task = new Task(defaultTaskOptions)
		await provider.setCurrentTask(task)
		return task
	}

	// The task rebuilds its handler from what it is handed, so an explicit save or switch
	// must hand over the profile even when the provider and the model stay the same.
	test("saving the active profile hands it to the current task", async () => {
		const task = await openTask()
		const saved = {
			apiProvider: "openrouter" as const,
			openRouterModelId: "openai/gpt-4",
			rateLimitSeconds: 5,
			modelTemperature: 0.7,
		}

		await provider.upsertProviderProfile("test-config", saved, true)

		expect(task.updateApiConfiguration).toHaveBeenCalledWith(saved)
	})

	test("saving a profile with no task open still saves and activates it", async () => {
		await expect(
			provider.upsertProviderProfile("test-config", { apiProvider: "openrouter", openRouterModelId: "x" }, true),
		).resolves.toBe("test-id")
	})

	test.each([
		["other settings of the same model", { modelTemperature: 0.9, rateLimitSeconds: 7 }],
		["only the compact profile flag", { compactProfile: true }],
	])("switching to a profile that differs in %s hands it to the current task", async (_name, differences) => {
		const task = await openTask()
		const profile = {
			name: "test-config",
			id: "test-id",
			apiProvider: "openrouter",
			openRouterModelId: "openai/gpt-4",
			...differences,
		}
		;(provider as any).providerSettingsManager.activateProfile = vi.fn().mockResolvedValue(profile)

		await provider.activateProviderProfile({ name: "test-config" })

		expect(task.updateApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({ apiProvider: "openrouter", openRouterModelId: "openai/gpt-4", ...differences }),
		)
	})
})
