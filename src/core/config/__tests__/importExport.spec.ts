// cd src && ./node_modules/.bin/vitest run core/config/__tests__/importExport.spec.ts

import fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"
import type { Mock } from "vitest"

import {
	createKnownPersistedProviderProfile,
	TelemetryEventName,
	type PersistedProviderProfile,
	type ProviderSettingsWithId,
} from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"
import { safeWriteJson } from "@tumble-code/core/fs"

import { importSettings, importSettingsFromPath, importSettingsWithFeedback, exportSettings } from "../importExport"
import { ProviderSettingsManager } from "../ProviderSettingsManager"
import type { ContextProxy } from "../ContextProxy"
import type { CustomModesManager } from "../CustomModesManager"
import { logger } from "../../../utils/logging"

vi.mock("vscode", () => ({
	workspace: {},
	window: {
		showOpenDialog: vi.fn(),
		showSaveDialog: vi.fn(),
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
	},
	Uri: { file: vi.fn((filePath: string) => ({ fsPath: filePath })) },
}))

vi.mock("fs/promises", () => {
	const api = {
		readFile: vi.fn(),
		mkdir: vi.fn(),
		access: vi.fn(),
		constants: { F_OK: 0, R_OK: 4 },
	}
	return { default: api, ...api }
})

vi.mock("os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("os")>()
	return { ...actual, default: { ...actual, homedir: () => "/mock/home" }, homedir: () => "/mock/home" }
})

vi.mock("@tumble-code/core/fs")

vi.mock("../../../i18n", () => ({ t: (key: string) => key }))

const FILE = "/mock/path/settings.json"
const STORE_KEY = "roo_cline_config_api_config"
const SECRETS_KEY = "roo_cline_config_provider_profile_secrets_v2"

/** The provider profiles envelope that `exportSettings` writes, built from flat profiles. */
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

/** The settings file the next import reads. */
function settingsFile(content: object | string) {
	vi.mocked(fs.readFile).mockResolvedValue(typeof content === "string" ? content : JSON.stringify(content))
}

describe("importExport", () => {
	let secrets: Map<string, string>
	let providerSettingsManager: ProviderSettingsManager
	let contextProxy: { setValues: Mock; setValue: Mock; getValue: Mock; export: Mock; setProviderSettings: Mock }
	let customModesManager: { updateCustomMode: Mock }

	const managers = () => ({
		providerSettingsManager,
		contextProxy: contextProxy as unknown as ContextProxy,
		customModesManager: customModesManager as unknown as CustomModesManager,
	})
	const runImport = () => importSettingsFromPath(FILE, managers())
	const storedProfiles = () => providerSettingsManager.readProfiles()
	const warningsOf = (result: Awaited<ReturnType<typeof runImport>>) => (result as { warnings?: string[] }).warnings

	beforeEach(() => {
		vi.clearAllMocks()
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
		secrets = new Map()
		const context = {
			secrets: {
				get: vi.fn(async (key: string) => secrets.get(key)),
				store: vi.fn(async (key: string, value: string) => void secrets.set(key, value)),
				delete: vi.fn(async (key: string) => void secrets.delete(key)),
			},
		} as unknown as vscode.ExtensionContext
		providerSettingsManager = new ProviderSettingsManager(context)
		contextProxy = {
			setValues: vi.fn(),
			setValue: vi.fn(),
			getValue: vi.fn(),
			export: vi.fn().mockResolvedValue({}),
			setProviderSettings: vi.fn(),
		}
		customModesManager = { updateCustomMode: vi.fn() }
	})

	describe("importSettingsFromPath", () => {
		it("adds the file's profiles to the local ones, makes its current profile current and applies its settings", async () => {
			await providerSettingsManager.saveConfig("local", { apiProvider: "openai", id: "local-id" })
			settingsFile({
				providerProfiles: v2File({
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai", id: "test-id", apiModelId: "gpt-4" } },
				}),
				globalSettings: { mode: "code", autoApprovalEnabled: true },
			})

			const result = await runImport()

			expect(result).toMatchObject({ success: true, warnings: undefined })
			expect(fs.readFile).toHaveBeenCalledWith(FILE, "utf-8")
			const stored = await storedProfiles()
			expect(Object.keys(stored.apiConfigs).sort()).toEqual(["default", "local", "test"])
			expect(stored.currentApiConfigName).toBe("test")
			expect(contextProxy.setValues).toHaveBeenCalledWith({ mode: "code", autoApprovalEnabled: true })
			expect(contextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "test")
			expect(contextProxy.setProviderSettings).toHaveBeenCalledWith(
				expect.objectContaining({ id: "test-id", apiProvider: "openai", apiModelId: "gpt-4" }),
			)
			expect(contextProxy.setValue).toHaveBeenCalledWith(
				"listApiConfigMeta",
				expect.arrayContaining([expect.objectContaining({ name: "test", id: "test-id" })]),
			)
		})

		// export() drops the token fields a model does not use; the import must
		// not write that filtered view back over the local profiles.
		it("leaves a local profile the file does not replace usable and complete", async () => {
			await providerSettingsManager.saveConfig("local-compat", {
				apiProvider: "openai",
				id: "local-compat-id",
				openAiBaseUrl: "http://localhost:8000/v1",
				openAiModelId: "qwen3-coder",
				modelTemperature: 1,
				modelMaxTokens: 4096,
				modelMaxThinkingTokens: 2048,
			})
			settingsFile({
				providerProfiles: v2File({
					currentApiConfigName: "imported",
					apiConfigs: { imported: { apiProvider: "anthropic", id: "imported-id" } },
				}),
			})

			expect((await runImport()).success).toBe(true)

			expect(await providerSettingsManager.getProfile({ name: "local-compat" })).toMatchObject({
				apiProvider: "openai",
				openAiBaseUrl: "http://localhost:8000/v1",
				openAiModelId: "qwen3-coder",
				modelTemperature: 1,
				modelMaxTokens: 4096,
				modelMaxThinkingTokens: 2048,
			})
			await expect(providerSettingsManager.activateProfile({ name: "local-compat" })).resolves.toMatchObject({
				apiProvider: "openai",
			})
		})

		it("imports its own export back with every profile usable", async () => {
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
			settingsFile({ providerProfiles: await providerSettingsManager.export() })

			const result = await runImport()

			expect(result).toMatchObject({ success: true, warnings: undefined })
			expect(await providerSettingsManager.getProfile({ name: "compat" })).toMatchObject({
				apiProvider: "openai",
				openAiModelId: "qwen3-coder",
			})
			expect(await providerSettingsManager.getProfile({ name: "claude" })).toMatchObject({
				apiProvider: "anthropic",
				apiModelId: "claude-sonnet-4-5",
			})
		})

		it("keeps the local id (and its secrets) for a same-name imported profile and remaps its mode binding", async () => {
			await providerSettingsManager.saveConfig("shared-name", {
				apiProvider: "openai",
				id: "local-id",
				openAiModelId: "local-model",
				openAiApiKey: "local-secret",
			})
			settingsFile({
				providerProfiles: v2File({
					currentApiConfigName: "shared-name",
					apiConfigs: {
						"shared-name": { apiProvider: "openai", id: "imported-id", openAiModelId: "imported-model" },
					},
					modeApiConfigs: { code: "imported-id" },
				}),
			})

			expect((await runImport()).success).toBe(true)

			const profile = await providerSettingsManager.getProfile({ name: "shared-name" })
			expect(profile).toMatchObject({
				id: "local-id",
				openAiModelId: "imported-model",
				openAiApiKey: "local-secret",
			})
			expect(await providerSettingsManager.getModeConfigId("code")).toBe("local-id")
			await expect(providerSettingsManager.getProfile({ id: "imported-id" })).rejects.toThrow()
		})

		it("keeps the local cloud profile ids", async () => {
			await providerSettingsManager.syncCloudProfiles({ cloud: { id: "cloud-id", apiProvider: "openai" } })
			settingsFile({
				providerProfiles: v2File({
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai", id: "test-id" } },
				}),
			})

			expect((await runImport()).success).toBe(true)

			expect((await storedProfiles()).cloudProfileIds).toEqual(["cloud-id"])
		})

		it("skips a profile without a provider, keeps a retired one opaque and falls back to a usable current profile", async () => {
			settingsFile({
				providerProfiles: v2File({
					currentApiConfigName: "gone",
					apiConfigs: {
						gone: opaqueProfile("gone-id", "unknown"),
						kept: { apiProvider: "openai", id: "kept-id" },
						retired: opaqueProfile("retired-id", "claude-code"),
					},
				}),
			})

			const result = await runImport()

			expect(result.success).toBe(true)
			expect(warningsOf(result)).toEqual([
				'Profile "gone" was skipped: apiProvider: Invalid provider',
				'Profile "retired": Unknown provider "claude-code" was preserved but cannot be used by this version.',
				'Profile "gone" was not available; defaulting to "kept".',
			])
			const stored = await storedProfiles()
			expect(stored.currentApiConfigName).toBe("kept")
			expect(stored.apiConfigs.gone).toBeUndefined()
			expect(stored.apiConfigs.retired.provider.providerId).toBe("claude-code")
			expect(contextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "kept")
		})

		it("fails and stores nothing when no profile of the file can be used", async () => {
			const before = await storedProfiles()
			settingsFile({
				providerProfiles: v2File({
					currentApiConfigName: "a",
					apiConfigs: { a: opaqueProfile("a-id", "unknown"), b: opaqueProfile("b-id", "unknown") },
				}),
			})

			const result = await runImport()

			expect(result).toEqual({
				success: false,
				error: 'No valid profiles could be imported:\nProfile "a" was skipped: apiProvider: Invalid provider\nProfile "b" was skipped: apiProvider: Invalid provider',
			})
			expect(await storedProfiles()).toEqual(before)
			expect(contextProxy.setValues).not.toHaveBeenCalled()
		})

		it("keeps the current profile when the file has no profiles, and imports its custom modes", async () => {
			const customModes = [
				{ slug: "mode1", name: "Mode One", roleDefinition: "Custom role one", groups: [] },
				{ slug: "mode2", name: "Mode Two", roleDefinition: "Custom role two", groups: [] },
			]
			settingsFile({
				providerProfiles: v2File({ currentApiConfigName: "missing", apiConfigs: {} }),
				globalSettings: { customModes },
			})

			expect((await runImport()).success).toBe(true)

			expect((await storedProfiles()).currentApiConfigName).toBe("default")
			expect(customModesManager.updateCustomMode.mock.calls).toEqual(customModes.map((mode) => [mode.slug, mode]))
		})

		it.each([
			["invalid JSON", "{ this is not valid JSON }", "JSON"],
			[
				"an envelope without a current profile",
				{ providerProfiles: { schemaVersion: 2, data: { apiConfigs: {} } } },
				"[providerProfiles.data.currentApiConfigName]: ",
			],
			[
				"an unversioned file",
				{
					providerProfiles: {
						currentApiConfigName: "a",
						apiConfigs: { a: { apiProvider: "openai", id: "a" } },
					},
				},
				"only version 2 is supported",
			],
		])("rejects %s and changes nothing", async (_label, content, error) => {
			await providerSettingsManager.saveConfig("openai", { apiProvider: "openai", id: "openai" })
			const storedBefore = secrets.get(STORE_KEY)
			settingsFile(content)

			const result = await runImport()

			expect(result.success).toBe(false)
			expect(result.error).toContain(error)
			expect(secrets.get(STORE_KEY)).toBe(storedBefore)
			expect(contextProxy.setValues).not.toHaveBeenCalled()
		})

		it("reports a schema error to telemetry", async () => {
			const capture = vi.spyOn(TelemetryService.instance, "capture")
			settingsFile({ providerProfiles: { schemaVersion: 2, data: { apiConfigs: {} } } })

			await runImport()

			expect(capture).toHaveBeenCalledWith(TelemetryEventName.SCHEMA_VALIDATION_ERROR, {
				schemaName: "ImportExport",
				error: expect.anything(),
			})
		})

		it("returns the read error", async () => {
			vi.mocked(fs.readFile).mockRejectedValue(new Error("File read error"))

			expect(await runImport()).toEqual({ success: false, error: "File read error" })
		})
	})

	describe("global settings of the file", () => {
		const importGlobalSettings = async (globalSettings: unknown) => {
			settingsFile({
				providerProfiles: v2File({
					currentApiConfigName: "p",
					apiConfigs: { p: { apiProvider: "openai", id: "p-id" } },
				}),
				...(globalSettings === undefined ? {} : { globalSettings }),
			})
			const result = await runImport()
			expect(result.success).toBe(true)
			return { warnings: warningsOf(result), applied: contextProxy.setValues.mock.calls[0][0] }
		}

		it("skips each invalid or unknown setting with a warning and applies the rest", async () => {
			const { warnings, applied } = await importGlobalSettings({
				customInstructions: "Keep this setting",
				autoApprovalEnabled: true,
				requestDelaySeconds: "slow",
				notASetting: 1,
				customModes: [{ slug: "broken mode", name: "", roleDefinition: "x", groups: ["read"] }],
			})

			expect(applied).toEqual({ customInstructions: "Keep this setting", autoApprovalEnabled: true })
			expect(warnings).toHaveLength(3)
			expect(warnings![0]).toContain('Setting "globalSettings.requestDelaySeconds" was skipped: [value]: ')
			expect(warnings![1]).toBe('Setting "globalSettings.notASetting" was skipped: Unknown setting.')
			expect(warnings![2]).toContain('Setting "globalSettings.customModes" was skipped: [0.slug]: ')
			expect(warnings![2]).toContain(", [0.name]: ")
			expect(customModesManager.updateCustomMode).not.toHaveBeenCalled()
		})

		it("drops the settings of the removed image generation feature without a warning", async () => {
			const { warnings, applied } = await importGlobalSettings({
				imageGenerationProvider: "openrouter",
				openRouterImageApiKey: "sk-image",
				openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
				customInstructions: "Keep this setting",
			})

			expect(warnings).toBeUndefined()
			expect(applied).toEqual({ customInstructions: "Keep this setting" })
		})

		it.each([
			["missing", undefined, undefined],
			["an array", [], ['Setting "globalSettings" was skipped: Expected object, received array.']],
			["a string", "x", ['Setting "globalSettings" was skipped: Expected object, received string.']],
		])("applies nothing when globalSettings is %s", async (_label, globalSettings, expectedWarnings) => {
			const { warnings, applied } = await importGlobalSettings(globalSettings)

			expect(applied).toEqual({})
			expect(warnings).toEqual(expectedWarnings)
		})
	})

	describe("importSettings", () => {
		it("returns without reading when the dialog is cancelled, offering Downloads first", async () => {
			vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined)

			const result = await importSettings(managers())

			expect(result).toEqual({ success: false, error: "User cancelled file selection" })
			expect(vscode.Uri.file).toHaveBeenCalledWith(path.join("/mock/home", "Downloads", "roo-code-settings.json"))
			expect(fs.readFile).not.toHaveBeenCalled()
		})

		it("imports the chosen file", async () => {
			vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: "/chosen.json" } as vscode.Uri])
			settingsFile({
				providerProfiles: v2File({
					currentApiConfigName: "p",
					apiConfigs: { p: { apiProvider: "openai", id: "p-id" } },
				}),
			})

			expect((await importSettings(managers())).success).toBe(true)
			expect(fs.readFile).toHaveBeenCalledWith("/chosen.json", "utf-8")
		})
	})

	describe("exportSettings", () => {
		const target = "/mock/path/roo-code-settings.json"

		beforeEach(() => {
			vi.mocked(vscode.window.showSaveDialog).mockResolvedValue({ fsPath: target } as vscode.Uri)
		})

		it("exports nothing when the dialog is cancelled", async () => {
			vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined)

			await exportSettings(managers())

			expect(contextProxy.export).not.toHaveBeenCalled()
			expect(safeWriteJson).not.toHaveBeenCalled()
		})

		it("writes the profiles without their secrets and the global settings, and remembers the place", async () => {
			await providerSettingsManager.saveConfig("openai", {
				apiProvider: "openai",
				id: "openai-id",
				openAiApiKey: "source-openai-key",
			})
			contextProxy.export.mockResolvedValue({ mode: "code", allowedMaxRequests: null })

			await exportSettings(managers())

			expect(fs.mkdir).toHaveBeenCalledWith("/mock/path", { recursive: true })
			const [writtenPath, written] = vi.mocked(safeWriteJson).mock.calls[0] as [string, any]
			expect(writtenPath).toBe(target)
			expect(written.providerProfiles).toEqual(await providerSettingsManager.export())
			expect(written.globalSettings).toEqual({ mode: "code", allowedMaxRequests: null })
			expect(JSON.stringify(written)).not.toContain("source-openai-key")
			expect(contextProxy.setValue).toHaveBeenCalledWith("lastSettingsExportPath", target)
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				"common:info.settings_exported_no_secrets",
			)
		})

		it.each([
			["the directory cannot be created", () => vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error("mkdir"))],
			["the file cannot be written", () => vi.mocked(safeWriteJson).mockRejectedValueOnce(new Error("write"))],
		])("logs and does not throw when %s", async (_label, fail) => {
			fail()
			const loggerError = vi.spyOn(logger, "error").mockImplementation(() => {})

			await expect(exportSettings(managers())).resolves.toBeUndefined()

			expect(loggerError).toHaveBeenCalledWith("Failed to export settings:", expect.any(Error))
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
			loggerError.mockRestore()
		})
	})

	describe("importSettingsWithFeedback", () => {
		let provider: { settingsImportedAt?: number; postStateToWebview: Mock }
		let seenImportedAt: (number | undefined)[]

		const withFeedback = (filePath?: string) => importSettingsWithFeedback({ ...managers(), provider }, filePath)
		const fileWithProfiles = (apiConfigs: Record<string, ProviderSettingsWithId | PersistedProviderProfile>) =>
			settingsFile({ providerProfiles: v2File({ currentApiConfigName: "valid", apiConfigs }) })

		beforeEach(() => {
			seenImportedAt = []
			provider = {
				settingsImportedAt: undefined,
				postStateToWebview: vi.fn(async () => void seenImportedAt.push(provider.settingsImportedAt)),
			}
			vi.mocked(fs.access).mockResolvedValue(undefined)
		})

		it("posts the imported state once with the import time, then clears it", async () => {
			fileWithProfiles({ valid: { apiProvider: "openai", id: "valid-id" } })

			await withFeedback(FILE)

			expect(fs.access).toHaveBeenCalledWith(FILE, fs.constants.F_OK | fs.constants.R_OK)
			expect(seenImportedAt).toHaveLength(1)
			expect(seenImportedAt[0]).toBeGreaterThan(0)
			expect(provider.settingsImportedAt).toBeUndefined()
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("common:info.settings_imported")
		})

		it.each([
			[1, "1 item had issues during import."],
			[2, "2 items had issues during import."],
		])("summarizes %i warning(s) in the toast and logs them in full", async (count, summary) => {
			const retired = Object.fromEntries(
				Array.from({ length: count }, (_, i) => [`retired-${i}`, opaqueProfile(`r-${i}`, `gone-${i}`)]),
			)
			fileWithProfiles({ valid: { apiProvider: "openai", id: "valid-id" }, ...retired })
			const loggerWarn = vi.spyOn(logger, "warn").mockImplementation(() => {})

			await withFeedback(FILE)

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				`common:info.settings_imported ${summary} See Developer Tools console for details.`,
			)
			expect(loggerWarn).toHaveBeenCalledWith(
				"Settings import completed with warnings:",
				Object.keys(retired).map((name) => expect.stringContaining(name)),
			)
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
			loggerWarn.mockRestore()
		})

		it("shows the error for a file it cannot access, without reading it", async () => {
			vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT: no such file or directory"))

			await withFeedback("/nonexistent/settings.json")

			expect(fs.readFile).not.toHaveBeenCalled()
			expect(provider.postStateToWebview).not.toHaveBeenCalled()
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.settings_import_failed")
		})

		it("asks for the file without a path", async () => {
			vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined)

			await withFeedback()

			expect(vscode.window.showOpenDialog).toHaveBeenCalled()
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.settings_import_failed")
		})
	})

	it("an opaque retired profile reads its secret from the secret store and exports without it", async () => {
		secrets.set(
			STORE_KEY,
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
		)
		secrets.set(SECRETS_KEY, JSON.stringify({ "retired-id": { apiKey: "legacy-key" } }))

		const exported = await providerSettingsManager.export()

		expect(JSON.stringify(exported)).not.toContain("legacy-key")
		expect(exported.data.apiConfigs.retired.provider.providerId).toBe("groq")
		expect(await providerSettingsManager.getProfile({ name: "retired" })).toMatchObject({
			apiKey: "legacy-key",
			apiModelId: "legacy-model",
		})
	})
})
