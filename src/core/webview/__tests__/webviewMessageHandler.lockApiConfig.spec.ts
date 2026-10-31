// pnpm --filter tumble-code test core/webview/__tests__/webviewMessageHandler.lockApiConfig.spec.ts

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

describe("webviewMessageHandler - lockApiConfigAcrossModes", () => {
	let mockProvider: {
		context: {
			workspaceState: {
				get: ReturnType<typeof vi.fn>
				update: ReturnType<typeof vi.fn>
			}
		}
		getState: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
		providerSettingsManager: {
			setModeConfig: ReturnType<typeof vi.fn>
		}
		postMessageToWebview: ReturnType<typeof vi.fn>
		getCurrentTask: ReturnType<typeof vi.fn>
		contextProxy: {
			getValue: ReturnType<typeof vi.fn>
			setValue: ReturnType<typeof vi.fn>
		}
	}

	beforeEach(() => {
		vi.clearAllMocks()

		mockProvider = {
			context: {
				workspaceState: {
					get: vi.fn(),
					update: vi.fn().mockResolvedValue(undefined),
				},
			},
			getState: vi.fn().mockResolvedValue({
				currentApiConfigName: "test-config",
				listApiConfigMeta: [{ name: "test-config", id: "config-123" }],
				customModes: [],
			}),
			postStateToWebview: vi.fn(),
			providerSettingsManager: {
				setModeConfig: vi.fn(),
			},
			postMessageToWebview: vi.fn(),
			getCurrentTask: vi.fn(),
			contextProxy: {
				getValue: vi.fn().mockReturnValue({ ask: true }),
				setValue: vi.fn().mockResolvedValue(undefined),
			},
		}
	})

	it.each([true, false])("stores lockApiConfigAcrossModes=%s for the workspace and binds no mode", async (bool) => {
		await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
			type: "lockApiConfigAcrossModes",
			bool,
		})

		expect(mockProvider.context.workspaceState.update).toHaveBeenCalledWith("lockApiConfigAcrossModes", bool)
		expect(mockProvider.providerSettingsManager.setModeConfig).not.toHaveBeenCalled()
		expect(mockProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("locking a mode binds the shown profile to it before recording the lock", async () => {
		await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
			type: "lockModeApiConfig",
			text: "code",
			bool: true,
			values: { configId: "config-123" },
		})

		expect(mockProvider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("code", "config-123")
		expect(mockProvider.contextProxy.setValue).toHaveBeenCalledWith("lockedApiConfigModes", {
			ask: true,
			code: true,
		})
		expect(mockProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("unlocking a mode drops only its lock and keeps its binding", async () => {
		await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
			type: "lockModeApiConfig",
			text: "ask",
			bool: false,
			values: { configId: "config-123" },
		})

		expect(mockProvider.providerSettingsManager.setModeConfig).not.toHaveBeenCalled()
		expect(mockProvider.contextProxy.setValue).toHaveBeenCalledWith("lockedApiConfigModes", {})
	})
})
