// npx vitest src/core/config/__tests__/importExport.spec.ts

import fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"

import {
	createKnownPersistedProviderProfile,
	providerProfileToLegacySettings,
	type PersistedProviderProfile,
	type ProviderName,
	type ProviderSettingsWithId,
} from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { importSettings, importSettingsFromPath, importSettingsWithFeedback, exportSettings } from "../importExport"
import { ProviderSettingsManager } from "../ProviderSettingsManager"
import { ContextProxy } from "../ContextProxy"
import { CustomModesManager } from "../CustomModesManager"
import { safeWriteJson } from "@tumble-code/core/fs"
import type { Mock } from "vitest"
import { logger } from "../../../utils/logging"

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn(),
		}),
	},
	window: {
		showOpenDialog: vi.fn(),
		showSaveDialog: vi.fn(),
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
	},
	Uri: {
		file: vi.fn((filePath) => ({ fsPath: filePath })),
	},
}))

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
		mkdir: vi.fn(),
		writeFile: vi.fn(),
		access: vi.fn(),
		constants: {
			F_OK: 0,
			R_OK: 4,
		},
	},
	readFile: vi.fn(),
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	access: vi.fn(),
	constants: {
		F_OK: 0,
		R_OK: 4,
	},
}))

vi.mock("os", () => ({
	default: {
		homedir: vi.fn(() => "/mock/home"),
	},
	homedir: vi.fn(() => "/mock/home"),
}))

vi.mock("@tumble-code/core/fs")

// Mock the model resolution to avoid provider details in tests
vi.mock("../../../api", () => {
	// Return different model info based on the provider and model
	const resolveModel = (config: { apiProvider?: string; apiModelId?: string }) => {
		if (config.apiProvider === "anthropic" && config.apiModelId === "claude-3-5-sonnet-20241022") {
			return {
				id: "claude-3-5-sonnet-20241022",
				info: {
					supportsReasoningBudget: true,
					requiredReasoningBudget: true,
				},
			}
		}
		// Default fallback
		return {
			id: config.apiModelId || "claude-sonnet-4-5",
			info: {
				supportsReasoningBudget: false,
				requiredReasoningBudget: false,
			},
		}
	}

	return {
		buildApiHandler: vi.fn().mockImplementation((config) => ({
			getModel: vi.fn().mockReturnValue(resolveModel(config)),
		})),
		resolveProviderModel: vi.fn().mockImplementation(resolveModel),
	}
})

/**
 * The provider profiles envelope (`{ schemaVersion: 2, data }`) that `export()` returns and
 * `exportSettings` writes, built from flat fixtures. A profile that is already persisted (has
 * `provider`, e.g. an opaque one) is kept as it is. Flat secrets are dropped by the conversion,
 * as they never travel in a file.
 */
function v2File(profiles: {
	currentApiConfigName: string
	apiConfigs: Record<string, ProviderSettingsWithId | PersistedProviderProfile>
	modeApiConfigs?: Record<string, string>
}) {
	return {
		schemaVersion: 2 as const,
		data: {
			...profiles,
			apiConfigs: Object.fromEntries(
				Object.entries(profiles.apiConfigs).map(([name, profile]) => [
					name,
					"provider" in profile ? profile : createKnownPersistedProviderProfile(profile),
				]),
			),
		},
	}
}

/** An opaque (unknown or retired provider) persisted profile. */
const opaqueProfile = (id: string, providerId: string): PersistedProviderProfile => ({
	id,
	provider: { providerId, opaqueLegacyPayload: { apiProvider: providerId } },
})

/** The provider id of a profile passed to `import()`, flat or persisted. */
const providerIdOf = (profile: ProviderSettingsWithId | PersistedProviderProfile) =>
	"provider" in profile ? profile.provider.providerId : profile.apiProvider

/** The flat fields of a persisted known-provider profile, for assertions. */
const flat = (profile: ProviderSettingsWithId | PersistedProviderProfile) =>
	"provider" in profile ? providerProfileToLegacySettings(profile) : profile

describe("importExport", () => {
	let mockProviderSettingsManager: ReturnType<typeof vi.mocked<ProviderSettingsManager>>
	let mockContextProxy: ReturnType<typeof vi.mocked<ContextProxy>>
	let mockExtensionContext: ReturnType<typeof vi.mocked<vscode.ExtensionContext>>
	let mockCustomModesManager: ReturnType<typeof vi.mocked<CustomModesManager>>

	beforeEach(() => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		mockProviderSettingsManager = {
			export: vi.fn().mockResolvedValue(
				v2File({
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				}),
			),
			// The mocked `export()` result is the stored data in these tests.
			readProfiles: vi.fn().mockImplementation(async () => (await mockProviderSettingsManager.export()).data),
			import: vi.fn(),
			listConfig: vi.fn(),
			// Reads back what the last `import()` call stored, as the real manager does.
			getProfile: vi.fn().mockImplementation(async ({ name }: { name: string }) => {
				const stored = mockProviderSettingsManager.import.mock.calls.at(-1)?.[0].apiConfigs[name]
				if (!stored) throw new Error(`Config with name '${name}' not found`)
				return { name, id: stored.id, ...flat(stored) }
			}),
		} as unknown as ReturnType<typeof vi.mocked<ProviderSettingsManager>>

		mockContextProxy = {
			setValues: vi.fn(),
			setValue: vi.fn(),
			export: vi.fn().mockImplementation(() => Promise.resolve({})),
			setProviderSettings: vi.fn(),
			getValue: vi.fn(),
		} as unknown as ReturnType<typeof vi.mocked<ContextProxy>>

		mockCustomModesManager = { updateCustomMode: vi.fn() } as unknown as ReturnType<
			typeof vi.mocked<CustomModesManager>
		>

		const map = new Map<string, string>()

		mockExtensionContext = {
			secrets: {
				get: vi.fn().mockImplementation((key: string) => map.get(key)),
				store: vi.fn().mockImplementation((key: string, value: string) => map.set(key, value)),
				delete: vi.fn().mockImplementation((key: string) => map.delete(key)),
			},
		} as unknown as ReturnType<typeof vi.mocked<vscode.ExtensionContext>>
	})

	describe("importSettings", () => {
		it("should return success: false when user cancels file selection", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue(undefined)

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result).toEqual({ success: false, error: "User cancelled file selection" })

			expect(vscode.window.showOpenDialog).toHaveBeenCalledWith({
				filters: { JSON: ["json"] },
				canSelectMany: false,
				defaultUri: expect.anything(), // Defaults to Downloads or last export path
			})

			expect(fs.readFile).not.toHaveBeenCalled()
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("partially imports valid global settings when invalid top-level keys are present", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(
				JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "valid-profile",
						apiConfigs: {
							"valid-profile": {
								apiProvider: "openai" as ProviderName,
								id: "valid-id",
							},
						},
					}),
					globalSettings: {
						customInstructions: "Keep this setting",
						autoApprovalEnabled: true,
						requestDelaySeconds: "slow", // invalid: expects number
						enterBehavior: "maybe", // invalid: not in enum
					},
				}),
			)
			mockProviderSettingsManager.export.mockResolvedValue(
				v2File({
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				}),
			)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
			])

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect((result as { warnings?: string[] }).warnings).toEqual(
				expect.arrayContaining([
					expect.stringContaining("globalSettings.requestDelaySeconds"),
					expect.stringContaining("globalSettings.enterBehavior"),
				]),
			)
			expect((mockContextProxy.setValues as Mock).mock.calls[0][0]).toEqual({
				customInstructions: "Keep this setting",
				autoApprovalEnabled: true,
			})
		})

		it("drops the settings of the removed image generation feature without a warning", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(
				JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "valid-profile",
						apiConfigs: {
							"valid-profile": {
								apiProvider: "openai" as ProviderName,
								id: "valid-id",
							},
						},
					}),
					globalSettings: {
						imageGenerationProvider: "openrouter",
						openRouterImageApiKey: "sk-image",
						openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
						experiments: { imageGeneration: true, preventFocusDisruption: true },
						customInstructions: "Keep this setting",
					},
				}),
			)
			mockProviderSettingsManager.export.mockResolvedValue(
				v2File({
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				}),
			)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
			])

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect((result as { warnings?: string[] }).warnings).toBeUndefined()
			expect((mockContextProxy.setValues as Mock).mock.calls[0][0]).toEqual({
				experiments: { preventFocusDisruption: true },
				customInstructions: "Keep this setting",
			})
		})

		it("skips invalid customModes without aborting unrelated settings import", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(
				JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "valid-profile",
						apiConfigs: {
							"valid-profile": {
								apiProvider: "openai" as ProviderName,
								id: "valid-id",
							},
						},
					}),
					globalSettings: {
						customInstructions: "Keep this setting",
						customModes: [{ slug: "broken-mode", name: "", roleDefinition: "", groups: ["invalid-group"] }],
					},
				}),
			)
			mockProviderSettingsManager.export.mockResolvedValue(
				v2File({
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				}),
			)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
			])

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect((result as { warnings?: string[] }).warnings).toEqual(
				expect.arrayContaining([expect.stringContaining("globalSettings.customModes")]),
			)
			expect(mockCustomModesManager.updateCustomMode).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).toHaveBeenCalledWith({ customInstructions: "Keep this setting" })
		})

		it("pins the exact warning text for skipped global settings (zod messages reach the user)", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(
				JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "valid-profile",
						apiConfigs: {
							"valid-profile": {
								apiProvider: "openai" as ProviderName,
								id: "valid-id",
							},
						},
					}),
					globalSettings: {
						autoApprovalEnabled: "yes",
						mode: 7,
						checkpointTimeout: 1.5,
						customModes: [{ slug: "broken mode", name: "", roleDefinition: "x", groups: ["read"] }],
					},
				}),
			)
			mockProviderSettingsManager.export.mockResolvedValue(
				v2File({
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				}),
			)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
			])

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect((result as { warnings?: string[] }).warnings).toEqual([
				'Setting "globalSettings.autoApprovalEnabled" was skipped: [value]: Invalid input: expected boolean, received string',
				'Setting "globalSettings.mode" was skipped: [value]: Invalid input: expected string, received number',
				'Setting "globalSettings.checkpointTimeout" was skipped: [value]: Invalid input: expected int, received number',
				'Setting "globalSettings.customModes" was skipped: [0.slug]: Slug must contain only letters numbers and dashes, [0.name]: Name is required',
			])
		})

		it("should import settings successfully from a valid file", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const mockFileContent = JSON.stringify({
				providerProfiles: v2File({
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				}),
				globalSettings: { mode: "code", autoApprovalEnabled: true },
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

			const previousProviderProfiles = v2File({
				currentApiConfigName: "default",
				apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
			})

			mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)

			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])

			mockContextProxy.export.mockResolvedValue({ mode: "code" })

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()

			expect(mockProviderSettingsManager.import).toHaveBeenCalledWith({
				currentApiConfigName: "test",
				apiConfigs: {
					default: { id: "default-id", provider: { providerId: "anthropic", config: {} } },
					test: { id: "test-id", provider: { providerId: "openai", config: {} } },
				},
				modeApiConfigs: {},
			})

			expect(mockContextProxy.setValues).toHaveBeenCalledWith({ mode: "code", autoApprovalEnabled: true })
			expect(mockContextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "test")

			expect(mockContextProxy.setValue).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])
		})

		it("should return success: false when file content is invalid", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			// Invalid content (missing required fields).
			const mockInvalidContent = JSON.stringify({
				providerProfiles: { schemaVersion: 2, data: { apiConfigs: {} } },
				globalSettings: {},
			})

			;(fs.readFile as Mock).mockResolvedValue(mockInvalidContent)

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result).toEqual({
				success: false,
				error: "[providerProfiles.data.currentApiConfigName]: Invalid input: expected string, received undefined",
			})
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("should import settings successfully when globalSettings key is missing", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const mockFileContent = JSON.stringify({
				providerProfiles: v2File({
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				}),
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

			const previousProviderProfiles = v2File({
				currentApiConfigName: "default",
				apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
			})

			mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)

			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])

			mockContextProxy.export.mockResolvedValue({ mode: "code" })

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockProviderSettingsManager.import).toHaveBeenCalledWith({
				currentApiConfigName: "test",
				apiConfigs: {
					default: { id: "default-id", provider: { providerId: "anthropic", config: {} } },
					test: { id: "test-id", provider: { providerId: "openai", config: {} } },
				},
				modeApiConfigs: {},
			})

			// Should call setValues with an empty object since globalSettings is missing.
			expect(mockContextProxy.setValues).toHaveBeenCalledWith({})
			expect(mockContextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "test")
			expect(mockContextProxy.setValue).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])
		})

		it("should return success: false when file content is not valid JSON", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			const mockInvalidJson = "{ this is not valid JSON }"
			;(fs.readFile as Mock).mockResolvedValue(mockInvalidJson)

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(false)
			expect(result.error).toMatch(/^Expected property name or '}' in JSON at position 2/)
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("should return success: false when reading file fails", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockRejectedValue(new Error("File read error"))

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result).toEqual({ success: false, error: "File read error" })
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("should not clobber existing api configs", async () => {
			const providerSettingsManager = new ProviderSettingsManager(mockExtensionContext)
			await providerSettingsManager.saveConfig("openai", { apiProvider: "openai", id: "openai" })

			const configs = await providerSettingsManager.listConfig()
			expect(configs[0].name).toBe("default")
			expect(configs[1].name).toBe("openai")
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const mockFileContent = JSON.stringify({
				globalSettings: { mode: "code" },
				providerProfiles: v2File({
					currentApiConfigName: "anthropic",
					apiConfigs: { default: { apiProvider: "anthropic" as const, id: "anthropic" } },
				}),
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

			mockContextProxy.export.mockResolvedValue({ mode: "code" })

			const result = await importSettings({
				providerSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			if (result.success && "providerProfiles" in result) {
				expect(result.providerProfiles?.apiConfigs["openai"]).toBeDefined()
				expect(result.providerProfiles?.apiConfigs["default"]).toBeDefined()
				expect(result.providerProfiles?.apiConfigs["default"].provider.providerId).toBe("anthropic")
			}
		})

		it("keeps a local OpenAI Compatible profile the file does not replace usable (not an unknown provider)", async () => {
			const providerSettingsManager = new ProviderSettingsManager(mockExtensionContext)
			await providerSettingsManager.saveConfig("local-compat", {
				apiProvider: "openai",
				id: "local-compat-id",
				openAiBaseUrl: "http://localhost:8000/v1",
				openAiModelId: "qwen3-coder",
				modelTemperature: 1,
			})
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(
				JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "imported",
						apiConfigs: { imported: { apiProvider: "anthropic", id: "imported-id" } },
					}),
				}),
			)

			const result = await importSettings({
				providerSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			const profile = await providerSettingsManager.getProfile({ name: "local-compat" })
			expect(profile.apiProvider).toBe("openai")
			expect(profile.openAiBaseUrl).toBe("http://localhost:8000/v1")
			expect(profile.openAiModelId).toBe("qwen3-coder")
			expect(profile.modelTemperature).toBe(1)
			await expect(providerSettingsManager.activateProfile({ name: "local-compat" })).resolves.toMatchObject({
				apiProvider: "openai",
			})
		})

		// export() drops the token fields a model does not use; the import must
		// not write that filtered view back over the local profiles.
		it("keeps the token fields of a local profile the file does not replace", async () => {
			const providerSettingsManager = new ProviderSettingsManager(mockExtensionContext)
			await providerSettingsManager.saveConfig("local-compat", {
				apiProvider: "openai",
				id: "local-compat-id",
				openAiModelId: "qwen3-coder",
				modelMaxTokens: 4096,
				modelMaxThinkingTokens: 2048,
			})
			const exportedProfile = (await providerSettingsManager.export()).data.apiConfigs["local-compat"]
			expect("shared" in exportedProfile && exportedProfile.shared?.modelMaxTokens).toBeFalsy()
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(
				JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "imported",
						apiConfigs: { imported: { apiProvider: "anthropic", id: "imported-id" } },
					}),
				}),
			)

			const result = await importSettings({
				providerSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect(await providerSettingsManager.getProfile({ name: "local-compat" })).toMatchObject({
				modelMaxTokens: 4096,
				modelMaxThinkingTokens: 2048,
			})
		})

		it("imports its own export back with every profile usable", async () => {
			const providerSettingsManager = new ProviderSettingsManager(mockExtensionContext)
			await providerSettingsManager.saveConfig("compat", {
				apiProvider: "openai",
				id: "compat-id",
				openAiBaseUrl: "http://localhost:8000/v1",
				openAiModelId: "qwen3-coder",
			})
			await providerSettingsManager.saveConfig("claude", {
				apiProvider: "anthropic",
				id: "claude-id",
				apiModelId: "claude-sonnet-4-5",
			})
			const exported = await providerSettingsManager.export()
			expect(exported.schemaVersion).toBe(2)
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(JSON.stringify({ providerProfiles: exported }))

			const result = await importSettings({
				providerSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect((result as { warnings?: string[] }).warnings).toBeUndefined()
			const compat = await providerSettingsManager.getProfile({ name: "compat" })
			expect(compat.apiProvider).toBe("openai")
			expect(compat.openAiModelId).toBe("qwen3-coder")
			const claude = await providerSettingsManager.getProfile({ name: "claude" })
			expect(claude.apiProvider).toBe("anthropic")
			expect(claude.apiModelId).toBe("claude-sonnet-4-5")
			const defaultProfile = await providerSettingsManager.getProfile({ name: "default" })
			expect(defaultProfile.apiProvider).toBe("anthropic")
		})

		it("rejects an unversioned file and leaves the stored profiles unchanged", async () => {
			const providerSettingsManager = new ProviderSettingsManager(mockExtensionContext)
			await providerSettingsManager.saveConfig("openai", { apiProvider: "openai", id: "openai" })
			const storedBefore = await mockExtensionContext.secrets.get("roo_cline_config_api_config")
			;(mockExtensionContext.secrets.store as Mock).mockClear()
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(
				JSON.stringify({
					providerProfiles: {
						currentApiConfigName: "a",
						apiConfigs: { a: { apiProvider: "openai", id: "a" } },
					},
				}),
			)

			const result = await importSettings({
				providerSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(false)
			expect(result.error).toContain("only version 2 is supported")
			expect(mockExtensionContext.secrets.store).not.toHaveBeenCalled()
			expect(await mockExtensionContext.secrets.get("roo_cline_config_api_config")).toBe(storedBefore)
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("keeps the local id (and its secrets) for a same-name imported profile and remaps its mode binding", async () => {
			const providerSettingsManager = new ProviderSettingsManager(mockExtensionContext)
			await providerSettingsManager.saveConfig("shared-name", {
				apiProvider: "openai",
				id: "local-id",
				openAiModelId: "local-model",
				openAiApiKey: "local-secret",
			})
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(
				JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "shared-name",
						apiConfigs: {
							"shared-name": {
								apiProvider: "openai",
								id: "imported-id",
								openAiModelId: "imported-model",
							},
						},
						modeApiConfigs: { code: "imported-id" },
					}),
				}),
			)

			const result = await importSettings({
				providerSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			const profile = await providerSettingsManager.getProfile({ name: "shared-name" })
			expect(profile.id).toBe("local-id")
			expect(profile.openAiModelId).toBe("imported-model")
			expect(profile.openAiApiKey).toBe("local-secret")
			expect(await providerSettingsManager.getModeConfigId("code")).toBe("local-id")
			await expect(providerSettingsManager.getProfile({ id: "imported-id" })).rejects.toThrow()
		})

		it("should call updateCustomMode for each custom mode in config", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const customModes = [
				{ slug: "mode1", name: "Mode One", roleDefinition: "Custom role one", groups: [] },
				{ slug: "mode2", name: "Mode Two", roleDefinition: "Custom role two", groups: [] },
			]

			const mockFileContent = JSON.stringify({
				providerProfiles: v2File({ currentApiConfigName: "test", apiConfigs: {} }),
				globalSettings: { mode: "code", customModes },
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

			mockProviderSettingsManager.export.mockResolvedValue(
				v2File({
					currentApiConfigName: "test",
					apiConfigs: {},
				}),
			)

			mockProviderSettingsManager.listConfig.mockResolvedValue([])

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect(mockCustomModesManager.updateCustomMode).toHaveBeenCalledTimes(customModes.length)

			customModes.forEach((mode) => {
				expect(mockCustomModesManager.updateCustomMode).toHaveBeenCalledWith(mode.slug, mode)
			})
		})

		it("should import settings from provided file path without showing dialog", async () => {
			const filePath = "/mock/path/settings.json"
			const mockFileContent = JSON.stringify({
				providerProfiles: v2File({
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				}),
				globalSettings: { mode: "code", autoApprovalEnabled: true },
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)
			;(fs.access as Mock).mockResolvedValue(undefined) // File exists and is readable

			const previousProviderProfiles = v2File({
				currentApiConfigName: "default",
				apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
			})

			mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])
			mockContextProxy.export.mockResolvedValue({ mode: "code" })

			const result = await importSettingsFromPath(filePath, {
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(vscode.window.showOpenDialog).not.toHaveBeenCalled()
			expect(fs.readFile).toHaveBeenCalledWith(filePath, "utf-8")
			expect(result.success).toBe(true)
			expect(mockProviderSettingsManager.import).toHaveBeenCalledWith({
				currentApiConfigName: "test",
				apiConfigs: {
					default: { id: "default-id", provider: { providerId: "anthropic", config: {} } },
					test: { id: "test-id", provider: { providerId: "openai", config: {} } },
				},
				modeApiConfigs: {},
			})
			expect(mockContextProxy.setValues).toHaveBeenCalledWith({ mode: "code", autoApprovalEnabled: true })
		})

		it("should return error when provided file path does not exist", async () => {
			const filePath = "/nonexistent/path/settings.json"
			const accessError = new Error("ENOENT: no such file or directory")

			;(fs.access as Mock).mockRejectedValue(accessError)

			// Create a mock provider for the test
			const mockProvider = {
				settingsImportedAt: 0,
				postStateToWebview: vi.fn().mockResolvedValue(undefined),
				postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
			}

			// Mock the showErrorMessage to capture the error
			const showErrorMessageSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined)

			await importSettingsWithFeedback(
				{
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
					provider: mockProvider,
				},
				filePath,
			)

			expect(vscode.window.showOpenDialog).not.toHaveBeenCalled()
			expect(fs.access).toHaveBeenCalledWith(filePath, fs.constants.F_OK | fs.constants.R_OK)
			expect(fs.readFile).not.toHaveBeenCalled()
			expect(showErrorMessageSpy).toHaveBeenCalledWith(expect.stringContaining("errors.settings_import_failed"))

			showErrorMessageSpy.mockRestore()
		})

		it("should handle import when reasoning budget fields are missing from config", async () => {
			// This test verifies that import works correctly when reasoning budget fields are not present

			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const mockFileContent = JSON.stringify({
				providerProfiles: v2File({
					currentApiConfigName: "openai-provider",
					apiConfigs: {
						"openai-provider": {
							apiProvider: "openai" as ProviderName,
							apiModelId: "gpt-4",
							id: "openai-id",
							// No modelMaxTokens or modelMaxThinkingTokens fields
						},
					},
				}),
				globalSettings: { mode: "code", autoApprovalEnabled: true },
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

			const previousProviderProfiles = v2File({
				currentApiConfigName: "default",
				apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
			})

			mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "openai-provider", id: "openai-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])

			mockContextProxy.export.mockResolvedValue({ mode: "code" })

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()

			expect(mockProviderSettingsManager.import).toHaveBeenCalledWith({
				currentApiConfigName: "openai-provider",
				apiConfigs: {
					default: { id: "default-id", provider: { providerId: "anthropic", config: {} } },
					"openai-provider": {
						id: "openai-id",
						provider: { providerId: "openai", config: { apiModelId: "gpt-4" } },
					},
				},
				modeApiConfigs: {},
			})

			expect(mockContextProxy.setValues).toHaveBeenCalledWith({ mode: "code", autoApprovalEnabled: true })
			expect(mockContextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "openai-provider")
		})

		describe("lenient import with invalid providers", () => {
			it("should sanitize profiles with invalid apiProvider and return warnings", async () => {
				// Test importing a profile with a removed/invalid provider like "claude-code"
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "valid-profile",
						apiConfigs: {
							"valid-profile": {
								apiProvider: "openai" as ProviderName,
								id: "valid-id",
							},
							"invalid-profile": opaqueProfile("invalid-id", "claude-code"), // Invalid/removed provider
						},
					}),
					globalSettings: { mode: "code" },
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				mockProviderSettingsManager.export.mockResolvedValue(
					v2File({
						currentApiConfigName: "default",
						apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
					}),
				)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
					{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
				])

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				// Import should succeed
				expect(result.success).toBe(true)

				// Should have warnings about the sanitized profile
				expect(result).toHaveProperty("warnings")
				expect((result as { warnings?: string[] }).warnings).toBeDefined()
				expect((result as { warnings?: string[] }).warnings!.length).toBeGreaterThan(0)
				expect((result as { warnings?: string[] }).warnings![0]).toContain("invalid-profile")
				expect((result as { warnings?: string[] }).warnings![0]).toContain("claude-code")

				// The valid profile should be imported
				expect(mockProviderSettingsManager.import).toHaveBeenCalled()
				const importedProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
				expect(importedProfiles.apiConfigs["valid-profile"]).toBeDefined()
				expect(providerIdOf(importedProfiles.apiConfigs["valid-profile"])).toBe("openai")

				// The unknown provider profile remains opaque so a newer client can recover it.
				expect(importedProfiles.apiConfigs["invalid-profile"]).toBeDefined()
				expect(providerIdOf(importedProfiles.apiConfigs["invalid-profile"])).toBe("claude-code")
			})

			it("should skip completely invalid profiles and return warnings", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "valid-profile",
						apiConfigs: {
							"valid-profile": {
								apiProvider: "openai" as ProviderName,
								id: "valid-id",
							},
							// No usable provider at all: skipped
							"type-invalid": opaqueProfile("type-invalid-id", "unknown"),
						},
					}),
					globalSettings: { mode: "code" },
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				mockProviderSettingsManager.export.mockResolvedValue(
					v2File({
						currentApiConfigName: "default",
						apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
					}),
				)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
				])

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				// Import should succeed (valid profile was imported)
				expect(result.success).toBe(true)

				// Should have warnings about the skipped profile
				expect((result as { warnings?: string[] }).warnings).toBeDefined()
				expect((result as { warnings?: string[] }).warnings!.some((w) => w.includes("type-invalid"))).toBe(true)
				expect((result as { warnings?: string[] }).warnings!.some((w) => w.includes("skipped"))).toBe(true)

				// The valid profile should be imported
				const importedProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
				expect(importedProfiles.apiConfigs["valid-profile"]).toBeDefined()

				// The type-invalid profile should NOT be imported
				expect(importedProfiles.apiConfigs["type-invalid"]).toBeUndefined()
			})

			it("should fail when NO valid profiles can be imported", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "invalid-profile",
						apiConfigs: {
							// No usable provider at all: skipped
							"invalid-profile-1": opaqueProfile("invalid-1", "unknown"),
							"invalid-profile-2": opaqueProfile("invalid-2", "unknown"),
						},
					}),
					globalSettings: { mode: "code" },
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				mockProviderSettingsManager.export.mockResolvedValue(
					v2File({
						currentApiConfigName: "default",
						apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
					}),
				)

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				// Import should fail since all profiles have schema validation errors
				expect(result.success).toBe(false)
				expect(result.error).toContain("No valid profiles could be imported")

				// Should NOT have called import since there were no valid profiles
				expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			})

			it("should show warning notification when importing with warnings via importSettingsWithFeedback", async () => {
				const filePath = "/mock/path/settings.json"
				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "valid-profile",
						apiConfigs: {
							"valid-profile": {
								apiProvider: "openai" as ProviderName,
								id: "valid-id",
							},
							"problematic-profile": opaqueProfile("problematic-id", "removed-provider"), // Invalid provider
						},
					}),
					globalSettings: { mode: "code" },
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)
				;(fs.access as Mock).mockResolvedValue(undefined)

				mockProviderSettingsManager.export.mockResolvedValue(
					v2File({
						currentApiConfigName: "default",
						apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
					}),
				)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
				])

				const seenImportedAt: Array<number | undefined> = []
				const mockProvider = {
					settingsImportedAt: undefined as number | undefined,
					postStateToWebview: vi.fn().mockImplementation(async () => {
						seenImportedAt.push(mockProvider.settingsImportedAt)
					}),
				}

				const showWarningMessageSpy = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined)
				const showInfoMessageSpy = vi
					.spyOn(vscode.window, "showInformationMessage")
					.mockResolvedValue(undefined)
				const loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {})

				await importSettingsWithFeedback(
					{
						providerSettingsManager: mockProviderSettingsManager,
						contextProxy: mockContextProxy,
						customModesManager: mockCustomModesManager,
						provider: mockProvider,
					},
					filePath,
				)

				// Should show warning message with short summary (not full details)
				expect(showWarningMessageSpy).toHaveBeenCalledWith(
					expect.stringContaining("1 item had issues during import."),
				)
				expect(showWarningMessageSpy).toHaveBeenCalledWith(
					expect.stringContaining("See Developer Tools console for details."),
				)
				// Should log full details to console
				expect(loggerWarnSpy).toHaveBeenCalledWith(
					"Settings import completed with warnings:",
					expect.arrayContaining([expect.stringContaining("problematic-profile")]),
				)
				expect(showInfoMessageSpy).not.toHaveBeenCalled()

				// Provider state should be delivered once, then cleared.
				expect(seenImportedAt).toHaveLength(1)
				expect(seenImportedAt[0]).toBeGreaterThan(0)
				expect(mockProvider.settingsImportedAt).toBeUndefined()
				expect(mockProvider.postStateToWebview).toHaveBeenCalled()

				showWarningMessageSpy.mockRestore()
				showInfoMessageSpy.mockRestore()
				loggerWarnSpy.mockRestore()
			})

			it("uses generic 'item' wording when only global settings have issues", async () => {
				const filePath = "/mock/path/settings.json"
				;(fs.readFile as Mock).mockResolvedValue(
					JSON.stringify({
						providerProfiles: v2File({
							currentApiConfigName: "valid-profile",
							apiConfigs: {
								"valid-profile": {
									apiProvider: "openai" as ProviderName,
									id: "valid-id",
								},
							},
						}),
						globalSettings: { requestDelaySeconds: "slow" },
					}),
				)
				;(fs.access as Mock).mockResolvedValue(undefined)
				mockProviderSettingsManager.export.mockResolvedValue(
					v2File({
						currentApiConfigName: "default",
						apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
					}),
				)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
				])
				const mockProvider = { settingsImportedAt: 0, postStateToWebview: vi.fn().mockResolvedValue(undefined) }
				const showWarningMessageSpy = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined)
				const loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {})

				await importSettingsWithFeedback(
					{
						providerSettingsManager: mockProviderSettingsManager,
						contextProxy: mockContextProxy,
						customModesManager: mockCustomModesManager,
						provider: mockProvider,
					},
					filePath,
				)

				expect(showWarningMessageSpy).toHaveBeenCalledWith(
					expect.stringContaining("1 item had issues during import."),
				)
				expect(showWarningMessageSpy).not.toHaveBeenCalledWith(expect.stringContaining("profile had issues"))
				expect(loggerWarnSpy).toHaveBeenCalledWith(
					"Settings import completed with warnings:",
					expect.arrayContaining([expect.stringContaining("globalSettings.requestDelaySeconds")]),
				)
				showWarningMessageSpy.mockRestore()
				loggerWarnSpy.mockRestore()
			})

			it("clears settingsImportedAt after posting the imported state so later launches do not replay it", async () => {
				const filePath = "/mock/path/settings.json"
				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "valid-profile",
						apiConfigs: {
							"valid-profile": {
								apiProvider: "openai" as ProviderName,
								id: "valid-id",
							},
						},
					}),
					globalSettings: { mode: "code" },
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)
				;(fs.access as Mock).mockResolvedValue(undefined)

				mockProviderSettingsManager.export.mockResolvedValue(
					v2File({
						currentApiConfigName: "default",
						apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
					}),
				)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
				])

				const seenImportedAt: Array<number | undefined> = []
				const mockProvider = {
					settingsImportedAt: undefined as number | undefined,
					postStateToWebview: vi.fn().mockImplementation(async () => {
						seenImportedAt.push(mockProvider.settingsImportedAt)
					}),
				}

				await importSettingsWithFeedback(
					{
						providerSettingsManager: mockProviderSettingsManager,
						contextProxy: mockContextProxy,
						customModesManager: mockCustomModesManager,
						provider: mockProvider,
					},
					filePath,
				)

				expect(seenImportedAt).toHaveLength(1)
				expect(seenImportedAt[0]).toBeGreaterThan(0)
				expect(mockProvider.settingsImportedAt).toBeUndefined()
			})

			it("should handle multiple profiles with mixed valid and invalid providers", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "anthropic-profile",
						apiConfigs: {
							"anthropic-profile": {
								apiProvider: "anthropic" as ProviderName,
								id: "anthropic-id",
							},
							"openai-profile": {
								apiProvider: "openai" as ProviderName,
								id: "openai-id",
							},
							"old-claude-profile": opaqueProfile("claude-id", "claude-code"), // Removed provider
							"another-invalid": opaqueProfile("another-id", "some-old-provider"), // Another removed provider
						},
					}),
					globalSettings: { mode: "code" },
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				mockProviderSettingsManager.export.mockResolvedValue(
					v2File({
						currentApiConfigName: "default",
						apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
					}),
				)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{ name: "anthropic-profile", id: "anthropic-id", apiProvider: "anthropic" as ProviderName },
					{ name: "openai-profile", id: "openai-id", apiProvider: "openai" as ProviderName },
				])

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				// Import should succeed
				expect(result.success).toBe(true)

				// Should have multiple warnings
				const warnings = (result as { warnings?: string[] }).warnings!
				expect(warnings.length).toBe(2) // Two profiles had invalid providers
				expect(warnings.some((w) => w.includes("old-claude-profile"))).toBe(true)
				expect(warnings.some((w) => w.includes("another-invalid"))).toBe(true)

				// Valid profiles should be imported correctly
				const importedProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
				expect(providerIdOf(importedProfiles.apiConfigs["anthropic-profile"])).toBe("anthropic")
				expect(providerIdOf(importedProfiles.apiConfigs["openai-profile"])).toBe("openai")

				// Unknown-provider profiles and their discriminators remain intact.
				expect(providerIdOf(importedProfiles.apiConfigs["old-claude-profile"])).toBe("claude-code")
				expect(providerIdOf(importedProfiles.apiConfigs["another-invalid"])).toBe("some-old-provider")
			})

			it("should fallback currentApiConfigName when the imported current profile was skipped", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				// Import file where currentApiConfigName points to an invalid profile that gets skipped
				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "invalid-current-profile", // This profile is completely invalid
						apiConfigs: {
							// No usable provider at all: skipped
							"invalid-current-profile": opaqueProfile("invalid-current-id", "unknown"),
							"valid-fallback-profile": {
								apiProvider: "openai" as ProviderName,
								id: "fallback-id",
							},
						},
					}),
					globalSettings: { mode: "code" },
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				mockProviderSettingsManager.export.mockResolvedValue(
					v2File({
						currentApiConfigName: "default",
						apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
					}),
				)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{ name: "valid-fallback-profile", id: "fallback-id", apiProvider: "openai" as ProviderName },
				])

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				// Import should succeed
				expect(result.success).toBe(true)

				// Should have warnings about the skipped profile AND the fallback
				const warnings = (result as { warnings?: string[] }).warnings!
				expect(warnings).toBeDefined()
				expect(warnings.some((w) => w.includes("invalid-current-profile") && w.includes("skipped"))).toBe(true)
				expect(
					warnings.some(
						(w) =>
							w.includes("invalid-current-profile") &&
							w.includes("not available") &&
							w.includes("valid-fallback-profile"),
					),
				).toBe(true)

				// The currentApiConfigName should be set to the valid fallback profile, not the invalid one
				const importedProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
				expect(importedProfiles.currentApiConfigName).toBe("valid-fallback-profile")

				// contextProxy should also be set with the fallback profile name
				expect(mockContextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "valid-fallback-profile")

				// The invalid profile should NOT be imported
				expect(importedProfiles.apiConfigs["invalid-current-profile"]).toBeUndefined()
				// The valid fallback profile should be imported
				expect(importedProfiles.apiConfigs["valid-fallback-profile"]).toBeDefined()
			})

			it("should keep previous currentApiConfigName when all imported profiles are invalid", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				// All profiles in the import are invalid, but we have existing profiles
				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "invalid-profile",
						apiConfigs: {
							"invalid-profile": opaqueProfile("invalid-id", "unknown"),
						},
					}),
					globalSettings: { mode: "code" },
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				mockProviderSettingsManager.export.mockResolvedValue(
					v2File({
						currentApiConfigName: "existing-profile",
						apiConfigs: {
							"existing-profile": { apiProvider: "anthropic" as ProviderName, id: "existing-id" },
						},
					}),
				)

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				// Import should fail because no valid profiles could be imported
				expect(result.success).toBe(false)
				expect(result.error).toContain("No valid profiles could be imported")
			})

			it("should show plural summary for multiple profile warnings via importSettingsWithFeedback", async () => {
				const filePath = "/mock/path/settings.json"
				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "valid-profile",
						apiConfigs: {
							"valid-profile": {
								apiProvider: "openai" as ProviderName,
								id: "valid-id",
							},
							"problematic-profile-1": opaqueProfile("problematic-id-1", "removed-provider-1"),
							"problematic-profile-2": opaqueProfile("problematic-id-2", "removed-provider-2"),
						},
					}),
					globalSettings: { mode: "code" },
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)
				;(fs.access as Mock).mockResolvedValue(undefined)

				mockProviderSettingsManager.export.mockResolvedValue(
					v2File({
						currentApiConfigName: "default",
						apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
					}),
				)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{ name: "valid-profile", id: "valid-id", apiProvider: "openai" as ProviderName },
				])

				const mockProvider = {
					settingsImportedAt: 0,
					postStateToWebview: vi.fn().mockResolvedValue(undefined),
				}

				const showWarningMessageSpy = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined)
				const loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {})

				await importSettingsWithFeedback(
					{
						providerSettingsManager: mockProviderSettingsManager,
						contextProxy: mockContextProxy,
						customModesManager: mockCustomModesManager,
						provider: mockProvider,
					},
					filePath,
				)

				// Should show warning message with plural summary for multiple warnings
				expect(showWarningMessageSpy).toHaveBeenCalledWith(
					expect.stringContaining("2 items had issues during import."),
				)
				// Should log full details to console
				expect(loggerWarnSpy).toHaveBeenCalledWith(
					"Settings import completed with warnings:",
					expect.arrayContaining([
						expect.stringContaining("problematic-profile-1"),
						expect.stringContaining("problematic-profile-2"),
					]),
				)

				showWarningMessageSpy.mockRestore()
				loggerWarnSpy.mockRestore()
			})
		})
	})

	describe("exportSettings", () => {
		it("should not export settings when user cancels file selection", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue(undefined)

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalledWith({
				filters: { JSON: ["json"] },
				defaultUri: expect.anything(),
			})

			expect(mockProviderSettingsManager.export).not.toHaveBeenCalled()
			expect(mockContextProxy.export).not.toHaveBeenCalled()
			expect(fs.writeFile).not.toHaveBeenCalled()
		})

		it("should export settings to the selected file location", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			const mockProviderProfiles = v2File({
				currentApiConfigName: "test",
				apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
			})

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
			const mockGlobalSettings = { mode: "code", autoApprovalEnabled: true }
			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalledWith({
				filters: { JSON: ["json"] },
				defaultUri: expect.anything(),
			})

			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockContextProxy.export).toHaveBeenCalled()
			expect(fs.mkdir).toHaveBeenCalledWith("/mock/path", { recursive: true })

			expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
				providerProfiles: mockProviderProfiles,
				globalSettings: mockGlobalSettings,
			})
		})

		it("should include globalSettings when allowedMaxRequests is null", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			const mockProviderProfiles = v2File({
				currentApiConfigName: "test",
				apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
			})

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)

			const mockGlobalSettings = {
				mode: "code",
				autoApprovalEnabled: true,
				allowedMaxRequests: null,
			}

			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
				providerProfiles: mockProviderProfiles,
				globalSettings: mockGlobalSettings,
			})
		})

		it("should handle errors during the export process", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue(
				v2File({
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				}),
			)

			mockContextProxy.export.mockResolvedValue({ mode: "code" })
			// Simulate an error during the safeWriteJson operation
			;(safeWriteJson as Mock).mockRejectedValueOnce(new Error("Safe write error"))

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalled()
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockContextProxy.export).toHaveBeenCalled()
			expect(fs.mkdir).toHaveBeenCalledWith("/mock/path", { recursive: true })
			expect(safeWriteJson).toHaveBeenCalled() // safeWriteJson is called, but it will throw
			// The error is caught and the function exits silently.
			// Optionally, ensure no error message was shown if that's part of "silent"
			// expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		})

		it("should handle errors during directory creation", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue(
				v2File({
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				}),
			)

			mockContextProxy.export.mockResolvedValue({ mode: "code" })
			;(fs.mkdir as Mock).mockRejectedValue(new Error("Directory creation error"))

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalled()
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockContextProxy.export).toHaveBeenCalled()
			expect(fs.mkdir).toHaveBeenCalled()
			expect(safeWriteJson).not.toHaveBeenCalled() // Should not be called since mkdir failed.
		})

		it("should use the correct default save location", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue(undefined)

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalledWith({
				filters: { JSON: ["json"] },
				defaultUri: expect.anything(),
			})

			expect(vscode.Uri.file).toHaveBeenCalledWith(path.join("/mock/home", "Downloads", "roo-code-settings.json"))
		})

		describe("codebase indexing export", () => {
			it("should export correct base URL for OpenAI Compatible provider", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = v2File({
					currentApiConfigName: "openai-compatible-provider",
					apiConfigs: {
						"openai-compatible-provider": {
							apiProvider: "openai" as ProviderName,
							id: "openai-compatible-id",
							// Remove OpenAI Compatible settings from provider profile
						},
						"ollama-provider": {
							apiProvider: "ollama" as ProviderName,
							id: "ollama-id",
						},
					},
					modeApiConfigs: {},
				})

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "http://localhost:11434", // Wrong URL from Ollama
						// OpenAI Compatible settings are now stored directly in codebaseIndexConfig
						codebaseIndexOpenAiCompatibleBaseUrl: "https://custom-openai-api.example.com/v1",
						codebaseIndexEmbedderModelDimension: 1536,
					},
				}

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
					providerProfiles: mockProviderProfiles,
					globalSettings: mockGlobalSettings,
				})
			})

			it("should export model dimension for OpenAI Compatible provider", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = v2File({
					currentApiConfigName: "test-provider",
					apiConfigs: {
						"test-provider": {
							apiProvider: "openai" as ProviderName,
							id: "test-id",
							// Remove OpenAI Compatible settings from provider profile
						},
					},
					modeApiConfigs: {},
				})

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "custom-embedding-model",
						codebaseIndexEmbedderBaseUrl: "",
						// OpenAI Compatible settings are now stored directly in codebaseIndexConfig
						codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
						codebaseIndexEmbedderModelDimension: 768,
					},
				}

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				const exportedData = (safeWriteJson as Mock).mock.calls[0][1]
				// Settings are now exported as-is from codebaseIndexConfig
				expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexEmbedderModelDimension).toBe(768)
				expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
					"https://api.example.com/v1",
				)
			})

			it("should not mix settings between different providers", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = v2File({
					currentApiConfigName: "openai-compatible-provider",
					apiConfigs: {
						"openai-compatible-provider": {
							apiProvider: "openai" as ProviderName,
							id: "openai-compatible-id",
							// Remove OpenAI Compatible settings from provider profile
						},
						"ollama-provider": {
							apiProvider: "ollama" as ProviderName,
							id: "ollama-id",
						},
						"anthropic-provider": {
							apiProvider: "anthropic" as ProviderName,
							id: "anthropic-id",
						},
					},
					modeApiConfigs: {},
				})

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "http://localhost:11434", // Wrong URL from Ollama
						// OpenAI Compatible settings are now stored directly in codebaseIndexConfig
						codebaseIndexOpenAiCompatibleBaseUrl: "https://openai-compatible.example.com/v1",
						codebaseIndexEmbedderModelDimension: 1536,
					},
				}

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				const exportedData = (safeWriteJson as Mock).mock.calls[0][1]
				// Settings are now exported as-is from codebaseIndexConfig
				expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
					"https://openai-compatible.example.com/v1",
				)
				expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexEmbedderModelDimension).toBe(1536)
				// The generic embedder base URL is still there
				expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexEmbedderBaseUrl).toBe(
					"http://localhost:11434",
				)
			})

			it("should handle missing provider-specific settings gracefully", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = v2File({
					currentApiConfigName: "incomplete-provider",
					apiConfigs: {
						"incomplete-provider": {
							apiProvider: "openai" as ProviderName,
							id: "incomplete-id",
							// Missing codebaseIndexOpenAiCompatibleBaseUrl and dimension
						},
					},
					modeApiConfigs: {},
				})

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "https://fallback.example.com/v1",
					},
				}

				// Mock getGlobalState to return undefined (no settings)
				mockContextProxy.getGlobalState = vi.fn().mockReturnValue(undefined)

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				// Should not throw an error and should preserve original settings
				expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
					providerProfiles: mockProviderProfiles,
					globalSettings: mockGlobalSettings, // Should remain unchanged
				})
			})

			it("should maintain backward compatibility with existing exports", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = v2File({
					currentApiConfigName: "openai-provider",
					apiConfigs: {
						"openai-provider": {
							apiProvider: "openai" as ProviderName,
							id: "openai-id",
							// Regular OpenAI provider without OpenAI Compatible settings
						},
					},
					modeApiConfigs: {},
				})

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai" as const, // Not openai-compatible
						codebaseIndexEmbedderModelId: "text-embedding-ada-002",
						codebaseIndexEmbedderBaseUrl: "https://api.openai.com/v1",
					},
				}

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				// Should not modify settings for non-openai-compatible providers
				expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
					providerProfiles: mockProviderProfiles,
					globalSettings: mockGlobalSettings, // Should remain unchanged
				})
			})

			it("should handle missing current provider gracefully", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = v2File({
					currentApiConfigName: "nonexistent-provider",
					apiConfigs: {
						"other-provider": {
							apiProvider: "openai" as ProviderName,
							id: "other-id",
						},
					},
					modeApiConfigs: {},
				})

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "https://fallback.example.com/v1",
					},
				}

				// Mock getGlobalState to return undefined (no settings)
				mockContextProxy.getGlobalState = vi.fn().mockReturnValue(undefined)

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				// Should not throw an error and should preserve original settings
				expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
					providerProfiles: mockProviderProfiles,
					globalSettings: mockGlobalSettings, // Should remain unchanged
				})
			})
		})

		describe("import with OpenAI Compatible codebase indexing settings", () => {
			it("should properly import OpenAI Compatible settings in codebaseIndexConfig", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "openai-compatible-provider",
						apiConfigs: {
							"openai-compatible-provider": {
								apiProvider: "openai" as ProviderName,
								id: "openai-compatible-id",
								// Provider-specific settings remain in provider profile
								codebaseIndexOpenAiCompatibleBaseUrl: "https://old-url.example.com/v1",
								codebaseIndexOpenAiCompatibleModelDimension: 512,
							},
						},
						modeApiConfigs: {},
					}),
					globalSettings: {
						mode: "code",
						codebaseIndexConfig: {
							codebaseIndexEnabled: true,
							codebaseIndexEmbedderProvider: "openai-compatible" as const,
							codebaseIndexEmbedderModelId: "text-embedding-3-small",
							codebaseIndexEmbedderBaseUrl: "https://imported-url.example.com/v1",
							codebaseIndexEmbedderModelDimension: 1536,
							// OpenAI Compatible settings are now stored directly here
							codebaseIndexOpenAiCompatibleBaseUrl: "https://imported-url.example.com/v1",
						},
					},
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				const previousProviderProfiles = v2File({
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				})

				mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{
						name: "openai-compatible-provider",
						id: "openai-compatible-id",
						apiProvider: "openai" as ProviderName,
					},
					{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
				])

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				expect(result.success).toBe(true)

				// Verify that the global settings were imported correctly
				expect(mockContextProxy.setValues).toHaveBeenCalledWith(
					expect.objectContaining({
						codebaseIndexConfig: expect.objectContaining({
							codebaseIndexOpenAiCompatibleBaseUrl: "https://imported-url.example.com/v1",
							codebaseIndexEmbedderModelDimension: 1536,
						}),
					}),
				)

				// Provider profiles are imported as-is
				const importedProviderProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
				const importedProvider = flat(importedProviderProfiles.apiConfigs["openai-compatible-provider"])

				// Provider still has its own settings (not modified by import)
				expect(importedProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBe("https://old-url.example.com/v1")
				expect(importedProvider.codebaseIndexOpenAiCompatibleModelDimension).toBe(512)
			})

			it("should handle missing OpenAI Compatible settings gracefully during import", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "openai-compatible-provider",
						apiConfigs: {
							"openai-compatible-provider": {
								apiProvider: "openai" as ProviderName,
								id: "openai-compatible-id",
							},
						},
						modeApiConfigs: {},
					}),
					globalSettings: {
						mode: "code",
						codebaseIndexConfig: {
							codebaseIndexEnabled: true,
							codebaseIndexEmbedderProvider: "openai-compatible" as const,
							codebaseIndexEmbedderModelId: "text-embedding-3-small",
							// Missing base URL and model dimension
						},
					},
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				const previousProviderProfiles = v2File({
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				})

				mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{
						name: "openai-compatible-provider",
						id: "openai-compatible-id",
						apiProvider: "openai" as ProviderName,
					},
				])

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				expect(result.success).toBe(true)
				// Should not throw an error when settings are missing
			})

			it("should not modify provider settings for non-openai-compatible providers during import", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				const mockFileContent = JSON.stringify({
					providerProfiles: v2File({
						currentApiConfigName: "anthropic-provider",
						apiConfigs: {
							"anthropic-provider": {
								apiProvider: "anthropic" as ProviderName,
								id: "anthropic-id",
							},
						},
						modeApiConfigs: {},
					}),
					globalSettings: {
						mode: "code",
						codebaseIndexConfig: {
							codebaseIndexEnabled: true,
							codebaseIndexEmbedderProvider: "openai" as const, // Not openai-compatible
							codebaseIndexEmbedderModelId: "text-embedding-ada-002",
							codebaseIndexEmbedderBaseUrl: "https://api.openai.com/v1",
							codebaseIndexEmbedderModelDimension: 1536,
						},
					},
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				const previousProviderProfiles = v2File({
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				})

				mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{ name: "anthropic-provider", id: "anthropic-id", apiProvider: "anthropic" as ProviderName },
				])

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				expect(result.success).toBe(true)

				// Verify that the provider settings were not modified with OpenAI Compatible fields
				const importedProviderProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
				const importedProvider = flat(importedProviderProfiles.apiConfigs["anthropic-provider"])

				expect(importedProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
				expect(importedProvider.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
			})
		})

		it("should preserve model dimension exactly in export/import roundtrip", async () => {
			// This test specifically isolates the model dimension export/import roundtrip
			// to catch the exact issue the user is experiencing

			const testModelDimension = 768

			// Step 1: Set up a provider without OpenAI Compatible settings in profile
			const mockProviderProfiles = v2File({
				currentApiConfigName: "test-openai-compatible",
				apiConfigs: {
					"test-openai-compatible": {
						apiProvider: "openai" as ProviderName,
						id: "test-id",
						// Remove OpenAI Compatible settings from provider profile
					},
				},
				modeApiConfigs: {},
			})

			const mockGlobalSettings = {
				mode: "code",
				codebaseIndexConfig: {
					codebaseIndexEnabled: true,
					codebaseIndexEmbedderProvider: "openai-compatible" as const,
					codebaseIndexEmbedderModelId: "custom-embedding-model",
					codebaseIndexEmbedderBaseUrl: "https://api.example.com/v1",
					codebaseIndexEmbedderModelDimension: testModelDimension,
					// OpenAI Compatible settings are now stored directly in codebaseIndexConfig
					codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
				},
			}

			// Step 2: Mock export operation
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/test-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
			;(fs.mkdir as Mock).mockResolvedValue(undefined)

			// Step 3: Export settings
			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			// Step 4: Verify the exported data includes the model dimension
			expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/test-settings.json", {
				providerProfiles: mockProviderProfiles,
				globalSettings: mockGlobalSettings,
			})

			// Step 5: Get the exported data for import test
			const exportedData = (safeWriteJson as Mock).mock.calls[0][1]
			const exportedFileContent = JSON.stringify(exportedData)

			// Step 6: Mock import operation
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/test-settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(exportedFileContent)

			// Reset mocks for import
			vi.clearAllMocks()
			mockProviderSettingsManager.export.mockResolvedValue(
				v2File({
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				}),
			)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test-openai-compatible", id: "test-id", apiProvider: "openai" as ProviderName },
			])

			// Step 7: Import the settings back
			const importResult = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			// Step 8: Verify import was successful
			expect(importResult.success).toBe(true)

			// Step 9: Verify that the model dimension was preserved exactly in global settings
			const importedGlobalSettings = mockContextProxy.setValues.mock.calls[0][0]
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexEmbedderModelDimension).toBe(
				testModelDimension,
			)
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
				"https://api.example.com/v1",
			)

			// Step 10: Verify that the embedder settings were imported correctly
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexEmbedderModelDimension).toBe(
				testModelDimension,
			)
		})

		it("should handle edge case model dimension values (0, null) correctly", async () => {
			// Test with model dimension = 0 (which is falsy but valid)
			const testModelDimension = 0

			const mockProviderProfiles = v2File({
				currentApiConfigName: "test-openai-compatible",
				apiConfigs: {
					"test-openai-compatible": {
						apiProvider: "openai" as ProviderName,
						id: "test-id",
						// Remove OpenAI Compatible settings from provider profile
					},
				},
				modeApiConfigs: {},
			})

			const mockGlobalSettings = {
				mode: "code",
				codebaseIndexConfig: {
					codebaseIndexEnabled: true,
					codebaseIndexEmbedderProvider: "openai-compatible" as const,
					codebaseIndexEmbedderModelId: "custom-embedding-model",
					codebaseIndexEmbedderBaseUrl: "https://api.example.com/v1",
					// OpenAI Compatible settings are now stored directly in codebaseIndexConfig
					codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
					codebaseIndexEmbedderModelDimension: testModelDimension, // 0 is a valid value
				},
			}

			// Mock export operation
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/test-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
			;(fs.mkdir as Mock).mockResolvedValue(undefined)

			// Export settings
			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			// Verify the exported data includes the model dimension even when it's 0
			const exportedData = (safeWriteJson as Mock).mock.calls[0][1]
			expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexEmbedderModelDimension).toBe(0)

			// Test import roundtrip
			const exportedFileContent = JSON.stringify(exportedData)
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/test-settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(exportedFileContent)

			// Reset mocks for import
			vi.clearAllMocks()
			mockProviderSettingsManager.export.mockResolvedValue(
				v2File({
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				}),
			)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test-openai-compatible", id: "test-id", apiProvider: "openai" as ProviderName },
			])

			// Import the settings back
			const importResult = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(importResult.success).toBe(true)

			// Verify that model dimension 0 was preserved in global settings
			const setValuesCall = mockContextProxy.setValues.mock.calls[0][0]
			expect(setValuesCall.codebaseIndexConfig?.codebaseIndexEmbedderModelDimension).toBe(0)
		})

		it("should handle missing model dimension gracefully", async () => {
			// Test when model dimension is undefined in global state
			const mockProviderProfiles = v2File({
				currentApiConfigName: "test-openai-compatible",
				apiConfigs: {
					"test-openai-compatible": {
						apiProvider: "openai" as ProviderName,
						id: "test-id",
						// Remove OpenAI Compatible settings from provider profile
					},
				},
				modeApiConfigs: {},
			})

			const mockGlobalSettings = {
				mode: "code",
				codebaseIndexConfig: {
					codebaseIndexEnabled: true,
					codebaseIndexEmbedderProvider: "openai-compatible" as const,
					codebaseIndexEmbedderModelId: "custom-embedding-model",
					codebaseIndexEmbedderBaseUrl: "https://api.example.com/v1",
				},
			}

			// Mock getGlobalState to return undefined for model dimension
			mockContextProxy.getGlobalState = vi.fn().mockImplementation((key: string) => {
				if (key === "codebaseIndexOpenAiCompatibleBaseUrl") {
					return "https://api.example.com/v1"
				}
				if (key === "codebaseIndexOpenAiCompatibleModelDimension") {
					return undefined
				}
				return undefined
			})

			// Mock export operation
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/test-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
			;(fs.mkdir as Mock).mockResolvedValue(undefined)

			// Export settings
			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			// Verify the exported data does NOT include model dimension when it's undefined
			const exportedData = (safeWriteJson as Mock).mock.calls[0][1]
			expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexEmbedderModelDimension).toBeUndefined()
		})

		it("should handle provider mismatch during import - BUG REPRODUCTION", async () => {
			// This test reproduces the bug where model dimension is lost when importing
			// settings where the current provider is different from the exported provider

			// Step 1: Create exported settings from "provider-a" with model dimension
			const exportedSettings = {
				providerProfiles: v2File({
					currentApiConfigName: "provider-a",
					apiConfigs: {
						"provider-a": {
							apiProvider: "openai" as ProviderName,
							id: "provider-a-id",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api-a.example.com/v1",
							codebaseIndexOpenAiCompatibleModelDimension: 1536,
						},
						"provider-b": {
							apiProvider: "anthropic" as ProviderName,
							id: "provider-b-id",
						},
					},
					modeApiConfigs: {},
				}),
				globalSettings: {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "https://api-a.example.com/v1",
						codebaseIndexEmbedderModelDimension: 1536,
					},
				},
			}

			// Step 2: Set up import environment where current provider is "provider-b" (different!)
			const currentProviderProfiles = v2File({
				currentApiConfigName: "provider-b", // Different from exported settings!
				apiConfigs: {
					"provider-b": {
						apiProvider: "anthropic" as ProviderName,
						id: "provider-b-id",
					},
				},
			})

			// Step 3: Mock import operation
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(JSON.stringify(exportedSettings))

			mockProviderSettingsManager.export.mockResolvedValue(currentProviderProfiles)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "provider-a", id: "provider-a-id", apiProvider: "openai" as ProviderName },
				{ name: "provider-b", id: "provider-b-id", apiProvider: "anthropic" as ProviderName },
			])

			// Step 4: Import the settings
			const importResult = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(importResult.success).toBe(true)

			// Step 5: Check what was imported
			const importedProviderProfiles = mockProviderSettingsManager.import.mock.calls[0][0]

			// The bug: provider-a should have its model dimension preserved, but it might be lost
			// because the import logic only updates the CURRENT provider (provider-b)
			const providerA = flat(importedProviderProfiles.apiConfigs["provider-a"])
			const providerB = flat(importedProviderProfiles.apiConfigs["provider-b"])

			// This should pass but might fail due to the bug
			expect(providerA.codebaseIndexOpenAiCompatibleModelDimension).toBe(1536)
			expect(providerA.codebaseIndexOpenAiCompatibleBaseUrl).toBe("https://api-a.example.com/v1")

			// Provider B should not have OpenAI Compatible settings
			expect(providerB.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
			expect(providerB.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
		})

		it("should NOT copy OpenAI Compatible settings to provider profiles - FIXED BEHAVIOR", async () => {
			// This test verifies the FIXED behavior: OpenAI Compatible settings stay in global settings only

			const exportedSettings = {
				providerProfiles: v2File({
					currentApiConfigName: "openai-compatible-provider",
					apiConfigs: {
						"openai-compatible-provider": {
							apiProvider: "openai" as ProviderName,
							id: "openai-compatible-id",
							// NO OpenAI Compatible settings here in the fixed version
						},
						"anthropic-provider": {
							apiProvider: "anthropic" as ProviderName,
							id: "anthropic-id",
						},
					},
					modeApiConfigs: {},
				}),
				globalSettings: {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "https://new-url.example.com/v1",
						codebaseIndexEmbedderModelDimension: 1536,
						// OpenAI Compatible settings are stored here
						codebaseIndexOpenAiCompatibleBaseUrl: "https://new-url.example.com/v1",
						codebaseIndexOpenAiCompatibleModelDimension: 1536,
					},
				},
			}

			const currentProviderProfiles = v2File({
				currentApiConfigName: "anthropic-provider",
				apiConfigs: {
					"anthropic-provider": {
						apiProvider: "anthropic" as ProviderName,
						id: "anthropic-id",
					},
				},
			})

			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(JSON.stringify(exportedSettings))

			mockProviderSettingsManager.export.mockResolvedValue(currentProviderProfiles)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{
					name: "openai-compatible-provider",
					id: "openai-compatible-id",
					apiProvider: "openai" as ProviderName,
				},
				{ name: "anthropic-provider", id: "anthropic-id", apiProvider: "anthropic" as ProviderName },
			])

			const importResult = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(importResult.success).toBe(true)

			// Verify OpenAI Compatible settings are imported to global settings
			const importedGlobalSettings = mockContextProxy.setValues.mock.calls[0][0]
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
				"https://new-url.example.com/v1",
			)
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleModelDimension).toBe(1536)

			// Verify provider profiles do NOT have OpenAI Compatible settings
			const importedProviderProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
			const openaiCompatibleProvider = flat(importedProviderProfiles.apiConfigs["openai-compatible-provider"])
			const anthropicProvider = flat(importedProviderProfiles.apiConfigs["anthropic-provider"])

			// Neither provider should have OpenAI Compatible settings
			expect(openaiCompatibleProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
			expect(openaiCompatibleProvider.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
			expect(anthropicProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
			expect(anthropicProvider.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
		})

		it("should keep OpenAI Compatible settings in global state only - FIXED BEHAVIOR", async () => {
			// This test verifies that OpenAI Compatible settings remain in global state
			// and are NOT copied to provider profiles

			const exportedSettings = {
				providerProfiles: v2File({
					currentApiConfigName: "anthropic-provider",
					apiConfigs: {
						"anthropic-provider": {
							apiProvider: "anthropic" as ProviderName,
							id: "anthropic-id",
						},
						"openai-compatible-provider": {
							apiProvider: "openai" as ProviderName,
							id: "openai-compatible-id",
							// NO OpenAI Compatible settings in provider profiles
						},
					},
					modeApiConfigs: {},
				}),
				globalSettings: {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "https://updated.example.com/v1",
						codebaseIndexEmbedderModelDimension: 1536,
						// OpenAI Compatible settings are stored here
						codebaseIndexOpenAiCompatibleBaseUrl: "https://updated.example.com/v1",
						codebaseIndexOpenAiCompatibleModelDimension: 1536,
					},
				},
			}

			const currentProviderProfiles = v2File({
				currentApiConfigName: "default",
				apiConfigs: {
					default: {
						apiProvider: "openai" as ProviderName,
						id: "default-id",
					},
				},
			})

			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(JSON.stringify(exportedSettings))

			mockProviderSettingsManager.export.mockResolvedValue(currentProviderProfiles)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "anthropic-provider", id: "anthropic-id", apiProvider: "anthropic" as ProviderName },
				{
					name: "openai-compatible-provider",
					id: "openai-compatible-id",
					apiProvider: "openai" as ProviderName,
				},
				{ name: "default", id: "default-id", apiProvider: "openai" as ProviderName },
			])

			const importResult = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(importResult.success).toBe(true)

			// Verify OpenAI Compatible settings are imported to global settings
			const importedGlobalSettings = mockContextProxy.setValues.mock.calls[0][0]
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
				"https://updated.example.com/v1",
			)
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleModelDimension).toBe(1536)

			// Verify NO provider profiles have OpenAI Compatible settings
			const importedProviderProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
			const anthropicProvider = flat(importedProviderProfiles.apiConfigs["anthropic-provider"])
			const openaiCompatibleProvider = flat(importedProviderProfiles.apiConfigs["openai-compatible-provider"])

			// Neither provider should have OpenAI Compatible settings
			expect(anthropicProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
			expect(anthropicProvider.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
			expect(openaiCompatibleProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
			expect(openaiCompatibleProvider.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
		})

		it("should export OpenAI Compatible settings from global state when provider is openai-compatible", async () => {
			// This test reproduces the bug where codebaseIndexEmbedderModelDimension is missing from exported JSON
			// when the OpenAI Compatible settings are stored in global state via contextProxy

			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			// Set up provider profiles - note that the OpenAI Compatible provider does NOT have
			// the codebaseIndexOpenAiCompatibleBaseUrl and codebaseIndexOpenAiCompatibleModelDimension
			// fields in the provider profile itself
			const mockProviderProfiles = v2File({
				currentApiConfigName: "openrouter-provider", // Current provider is OpenRouter
				apiConfigs: {
					"openrouter-provider": {
						apiProvider: "openrouter" as ProviderName,
						id: "openrouter-id",
						// OpenRouter doesn't have OpenAI Compatible fields
					},
				},
				modeApiConfigs: {},
			})

			// The global settings now include OpenAI Compatible settings directly in codebaseIndexConfig
			const mockGlobalSettings = {
				mode: "code",
				codebaseIndexConfig: {
					codebaseIndexEnabled: true,
					codebaseIndexEmbedderProvider: "openai-compatible" as const,
					codebaseIndexEmbedderModelId: "text-embedding-3-small",
					codebaseIndexEmbedderBaseUrl: "https://custom-api.example.com/v1",
					codebaseIndexEmbedderModelDimension: 1536,
					// OpenAI Compatible settings are now included directly
					codebaseIndexOpenAiCompatibleBaseUrl: "https://custom-api.example.com/v1",
					codebaseIndexOpenAiCompatibleModelDimension: 1536,
				},
			}

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
			;(fs.mkdir as Mock).mockResolvedValue(undefined)

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			// Verify that the exported JSON contains the OpenAI Compatible settings
			const exportedData = (safeWriteJson as Mock).mock.calls[0][1]

			// With the fix, these values are now properly exported
			expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleModelDimension).toBe(
				1536,
			)
			expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
				"https://custom-api.example.com/v1",
			)
		})

		it.each([
			{
				testCase: "supportsReasoningBudget is false",
				providerName: "deepseek-provider",
				modelId: "deepseek-chat",
				providerId: "deepseek-id",
			},
			{
				testCase: "requiredReasoningBudget is false",
				providerName: "deepseek-provider-2",
				modelId: "deepseek-coder",
				providerId: "deepseek-id-2",
			},
			{
				testCase: "both supportsReasoningBudget and requiredReasoningBudget are false",
				providerName: "deepseek-provider-3",
				modelId: "deepseek-reasoner",
				providerId: "deepseek-id-3",
			},
		])(
			"should exclude modelMaxTokens and modelMaxThinkingTokens when $testCase",
			async ({ providerName, modelId, providerId }) => {
				// This test verifies that token fields are excluded when model doesn't support reasoning budget
				// Using deepseek provider which uses apiModelId and has supportsReasoningBudget: false

				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				// Use a real ProviderSettingsManager instance to test the actual filtering logic
				const realProviderSettingsManager = new ProviderSettingsManager(mockExtensionContext)

				// Wait for initialization to complete
				await realProviderSettingsManager.initialize()

				// Save a deepseek provider config with token fields
				await realProviderSettingsManager.saveConfig(providerName, {
					apiProvider: "deepseek" as ProviderName,
					apiModelId: modelId,
					id: providerId,
					deepSeekApiKey: "test-key",
					modelMaxTokens: 4096, // This should be removed during export
					modelMaxThinkingTokens: 2048, // This should be removed during export
				})

				// Set this as the current provider
				await realProviderSettingsManager.activateProfile({ name: providerName })

				const mockGlobalSettings = {
					mode: "code",
					autoApprovalEnabled: true,
				}

				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: realProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				// Get the exported data
				const exportedData = (safeWriteJson as Mock).mock.calls[0][1]

				// Verify that token fields were excluded because reasoning budget is not supported/required
				expect(exportedData.providerProfiles.schemaVersion).toBe(2)
				const provider = exportedData.providerProfiles.data.apiConfigs[providerName]
				expect(provider).toBeDefined()
				expect(provider.provider.config.apiModelId).toBe(modelId)
				expect(provider.shared?.modelMaxTokens).toBeUndefined()
				expect(provider.shared?.modelMaxThinkingTokens).toBeUndefined()
			},
		)
	})

	// H1/H2/R2: real-manager secret round-trip tests. These exercise the
	// actual `updateProfileSecrets` boundary against a Map-backed
	// `ExtensionContext.secrets` (no mocked `ProviderSettingsManager.import`)
	// so the secret-preservation behavior is asserted end-to-end rather than
	// via a call-argument mock.
	describe("secret round-trip through the real ProviderSettingsManager", () => {
		const mapBackedContext = (map: Map<string, string>) =>
			({
				secrets: {
					get: vi.fn().mockImplementation((key: string) => map.get(key)),
					store: vi.fn().mockImplementation((key: string, value: string) => {
						map.set(key, value)
					}),
					delete: vi.fn().mockImplementation((key: string) => {
						map.delete(key)
					}),
				},
			}) as unknown as ReturnType<typeof vi.mocked<vscode.ExtensionContext>>

		it("R2: v2 export -> v2 import does NOT transfer secrets; existing local secrets are preserved on import", async () => {
			// Source install: a known provider with a secret in the v2 store.
			const sourceMap = new Map<string, string>()
			const sourceManager = new ProviderSettingsManager(mapBackedContext(sourceMap))
			await sourceManager.initialize()
			await sourceManager.saveConfig("openai", {
				apiProvider: "openai" as ProviderName,
				apiModelId: "gpt-4o",
				id: "openai-id",
				openAiApiKey: "source-openai-key",
			})

			// Export the source install.
			const exported = await sourceManager.export()
			// H1: the export envelope must NOT contain the secret.
			expect(JSON.stringify(exported)).not.toContain("source-openai-key")

			// Target install: pre-seeded with its OWN secret for the same name.
			const targetMap = new Map<string, string>([
				[
					"roo_cline_config_api_config",
					JSON.stringify({
						schemaVersion: 2,
						data: {
							currentApiConfigName: "default",
							apiConfigs: {
								default: { id: "default-id", provider: { providerId: "anthropic", config: {} } },
								openai: {
									id: "openai-id",
									provider: { providerId: "openai", config: { apiModelId: "gpt-4o" } },
								},
							},
							modeApiConfigs: {},
						},
					}),
				],
				[
					"roo_cline_config_provider_profile_secrets_v2",
					JSON.stringify({ "openai-id": { openAiApiKey: "target-openai-key" } }),
				],
			])
			const targetManager = new ProviderSettingsManager(mapBackedContext(targetMap))
			await targetManager.initialize()

			// Import the source export into the target directly through the
			// manager to assert it does NOT pull secrets from the export (there
			// are none) and preserves what the target already had.
			await targetManager.import(exported.data)

			const targetSecrets = JSON.parse(targetMap.get("roo_cline_config_provider_profile_secrets_v2") ?? "{}")
			// H1: the source secret must NOT have been transferred.
			expect(JSON.stringify(targetSecrets)).not.toContain("source-openai-key")
			// The target's pre-existing secret survives (the export carried no
			// secret for this profile, so import() does not overwrite it).
			expect(targetSecrets["openai-id"]?.openAiApiKey).toBe("target-openai-key")
			const { name: _name, ...profile } = await targetManager.getProfile({ name: "openai" })
			expect(profile.openAiApiKey).toBe("target-openai-key")
		})

		it("R-extra: an opaque retired profile gets its secret from provider_profile_secrets_v2 and exports without it", async () => {
			const map = new Map<string, string>([
				[
					"roo_cline_config_api_config",
					JSON.stringify({
						schemaVersion: 2,
						data: {
							currentApiConfigName: "retired",
							apiConfigs: {
								retired: {
									id: "retired-id",
									provider: {
										providerId: "groq",
										opaqueLegacyPayload: { apiProvider: "groq", apiModelId: "legacy-model" },
									},
								},
							},
						},
					}),
				],
				[
					"roo_cline_config_provider_profile_secrets_v2",
					JSON.stringify({ "retired-id": { apiKey: "legacy-key" } }),
				],
			])
			const manager = new ProviderSettingsManager(mapBackedContext(map))
			await manager.initialize()

			// C3: the stored opaque payload never carries the secret.
			expect(map.get("roo_cline_config_api_config") ?? "").not.toContain("legacy-key")

			// Export must also be clean.
			const exported = await manager.export()
			expect(JSON.stringify(exported)).not.toContain("legacy-key")
			expect(exported.data.apiConfigs.retired.provider.providerId).toBe("groq")
			// And getProfile must still merge the secret back.
			const { name: _name, ...profile } = await manager.getProfile({ name: "retired" })
			expect(profile.apiKey).toBe("legacy-key")
			expect(profile.apiModelId).toBe("legacy-model")
		})
	})
})
