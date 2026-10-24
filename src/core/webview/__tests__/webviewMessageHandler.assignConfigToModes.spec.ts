// pnpm --filter tumble-code test core/webview/__tests__/webviewMessageHandler.assignConfigToModes.spec.ts

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

describe("webviewMessageHandler - assignCurrentApiConfigToModes", () => {
	let mockProvider: {
		getState: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
		providerSettingsManager: {
			setModeConfigs: ReturnType<typeof vi.fn>
		}
	}

	beforeEach(() => {
		vi.clearAllMocks()

		mockProvider = {
			getState: vi.fn().mockResolvedValue({
				currentApiConfigName: "local",
				listApiConfigMeta: [{ name: "local", id: "local-id" }],
				customModes: [],
			}),
			postStateToWebview: vi.fn(),
			providerSettingsManager: {
				setModeConfigs: vi.fn().mockResolvedValue(undefined),
			},
		}
	})

	it("assigns the given config id to the listed modes and posts state", async () => {
		await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
			type: "assignCurrentApiConfigToModes",
			values: { configId: "local-id", modeSlugs: ["code", "architect", "ask"] },
		})

		expect(mockProvider.providerSettingsManager.setModeConfigs).toHaveBeenCalledWith(
			["code", "architect", "ask"],
			"local-id",
		)
		expect(mockProvider.postStateToWebview).toHaveBeenCalled()
	})

	it.each([
		["no modes", { configId: "local-id", modeSlugs: [] }],
		["no config id", { modeSlugs: ["code"] }],
	])("does nothing with %s", async (_name, values) => {
		await webviewMessageHandler(mockProvider as unknown as ClineProvider, {
			type: "assignCurrentApiConfigToModes",
			values,
		})

		expect(mockProvider.providerSettingsManager.setModeConfigs).not.toHaveBeenCalled()
	})
})
