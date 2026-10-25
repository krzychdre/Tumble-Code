// autoImportSettings on a real file under a temporary home; the import itself
// (importSettingsFromPath, which importExport.spec.ts covers) and the vscode API are stand-ins.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import { autoImportSettings } from "../autoImportSettings"
import { importSettingsFromPath } from "../../core/config/importExport"
import { logger } from "../logging"

vi.mock("../../core/config/importExport", () => ({ importSettingsFromPath: vi.fn() }))

vi.mock("../../i18n", () => ({
	t: (key: string, params?: Record<string, unknown>) => `${key} ${JSON.stringify(params)}`,
}))

let home: string
let settingsPath: string | undefined
const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
const managers = { providerSettingsManager: {}, contextProxy: {}, customModesManager: {} } as any

beforeEach(async () => {
	home = await fs.mkdtemp(path.join(os.tmpdir(), "auto-import-spec-"))
	process.env.HOME = home
	process.env.USERPROFILE = home
	await fs.mkdir(path.join(home, "cfg"))
	await fs.writeFile(path.join(home, "cfg", "settings.json"), "{}")
	settingsPath = "~/cfg/settings.json"
	vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({ get: () => settingsPath } as any)
	vi.spyOn(vscode.window, "showInformationMessage").mockResolvedValue(undefined)
	vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined)
	vi.spyOn(logger, "info").mockImplementation(() => {})
	vi.spyOn(logger, "warn").mockImplementation(() => {})
	vi.spyOn(logger, "error").mockImplementation(() => {})
	vi.mocked(importSettingsFromPath)
		.mockReset()
		.mockResolvedValue({ success: true } as any)
})

afterEach(async () => {
	process.env.HOME = savedEnv.HOME
	process.env.USERPROFILE = savedEnv.USERPROFILE
	vi.restoreAllMocks()
	await fs.rm(home, { recursive: true, force: true })
})

describe("autoImportSettings", () => {
	it.each([
		["no path", undefined],
		["a blank path", "   "],
		["a path to a missing file", "~/cfg/missing.json"],
	])("does nothing for %s", async (_, configured) => {
		settingsPath = configured

		await autoImportSettings(managers)

		expect(importSettingsFromPath).not.toHaveBeenCalled()
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
	})

	it.each([
		["a ~/ path", () => "~/cfg/settings.json"],
		["an absolute path", () => path.join(home, "cfg", "settings.json")],
		["a relative path, taken from the home directory", () => path.join("cfg", "settings.json")],
	])("imports from %s", async (_, configured) => {
		settingsPath = ` ${configured()} `

		await autoImportSettings(managers)

		expect(importSettingsFromPath).toHaveBeenCalledWith(path.join(home, "cfg", "settings.json"), managers)
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			'common:info.auto_import_success {"filename":"settings.json"}',
		)
	})

	it.each([
		[["one"], "1 warning."],
		[["one", "two"], "2 warnings."],
	])("logs the import warnings %j", async (warnings, summary) => {
		vi.mocked(importSettingsFromPath).mockResolvedValue({ success: true, warnings } as any)

		await autoImportSettings(managers)

		expect(logger.warn).toHaveBeenCalledWith(`[AutoImport] Import completed with ${summary}`)
		for (const warning of warnings) expect(logger.warn).toHaveBeenCalledWith(`[AutoImport] Warning: ${warning}`)
	})

	it("warns the user about a failed import", async () => {
		vi.mocked(importSettingsFromPath).mockResolvedValue({ success: false, error: "bad json" } as any)

		await autoImportSettings(managers)

		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			'common:warnings.auto_import_failed {"error":"bad json"}',
		)
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
	})

	it("never lets an error stop the activation", async () => {
		vi.mocked(importSettingsFromPath).mockRejectedValue(new Error("disk gone"))

		await expect(autoImportSettings(managers)).resolves.toBeUndefined()
		expect(logger.error).toHaveBeenCalledWith("[AutoImport] Unexpected error during auto-import: disk gone")
	})
})
