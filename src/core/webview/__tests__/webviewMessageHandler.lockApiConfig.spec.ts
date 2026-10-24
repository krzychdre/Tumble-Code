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
})
