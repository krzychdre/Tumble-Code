import * as vscode from "vscode"

import { migrateFromRooCode } from "../migrateFromRooCode"

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
	},
	workspace: {
		getConfiguration: vi.fn(),
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
	},
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	readdir: vi.fn().mockResolvedValue([]),
	copyFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(false),
}))

const MIGRATION_FLAG = "tumble-code.migrationFromRooCodeCompleted"

describe("migrateFromRooCode", () => {
	let context: any
	let outputChannel: { appendLine: ReturnType<typeof vi.fn> }
	let globalState: Map<string, unknown>
	let legacyConfig: { inspect: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
	let newConfig: { inspect: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		vi.clearAllMocks()

		globalState = new Map()
		outputChannel = { appendLine: vi.fn() }

		context = {
			globalState: {
				get: vi.fn((key: string) => globalState.get(key)),
				update: vi.fn(async (key: string, value: unknown) => {
					globalState.set(key, value)
				}),
			},
			globalStorageUri: {
				fsPath: "/fake/User/globalStorage/QUB-IT.tumble-code",
			},
		}

		legacyConfig = {
			inspect: vi.fn().mockReturnValue(undefined),
			update: vi.fn().mockResolvedValue(undefined),
		}
		newConfig = {
			inspect: vi.fn().mockReturnValue(undefined),
			update: vi.fn().mockResolvedValue(undefined),
		}

		vi.mocked(vscode.workspace.getConfiguration).mockImplementation((section?: string) => {
			if (section === "roo-cline") return legacyConfig as any
			if (section === "tumble-code") return newConfig as any
			return { inspect: () => undefined, update: vi.fn() } as any
		})
	})

	it("returns immediately when the migration flag is already set", async () => {
		globalState.set(MIGRATION_FLAG, true)

		await migrateFromRooCode(context, outputChannel as any)

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(context.globalState.update).not.toHaveBeenCalled()
	})

	it("marks complete without prompting when no legacy config or storage exists", async () => {
		await migrateFromRooCode(context, outputChannel as any)

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(context.globalState.update).toHaveBeenCalledWith(MIGRATION_FLAG, true)
	})

	it("prompts and marks complete when user declines import", async () => {
		legacyConfig.inspect.mockImplementation((key: string) =>
			key === "allowedCommands" ? { globalValue: ["git status"] } : undefined,
		)
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("Skip" as any)

		await migrateFromRooCode(context, outputChannel as any)

		expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce()
		expect(globalState.get(MIGRATION_FLAG)).toBe(true)
		expect(newConfig.update).not.toHaveBeenCalled()
	})

	it("copies user-set config values from roo-cline to tumble-code when the user accepts", async () => {
		legacyConfig.inspect.mockImplementation((key: string) => {
			if (key === "allowedCommands") return { globalValue: ["git status", "git diff"] }
			if (key === "apiRequestTimeout") return { workspaceValue: 1200 }
			if (key === "enableCodeActions") return { defaultValue: true } // not user-set; should not migrate
			return undefined
		})
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("Import" as any)

		await migrateFromRooCode(context, outputChannel as any)

		expect(newConfig.update).toHaveBeenCalledWith("allowedCommands", ["git status", "git diff"], 1)
		expect(newConfig.update).toHaveBeenCalledWith("apiRequestTimeout", 1200, 2)
		// enableCodeActions only had defaultValue (not user-set) -- should not be copied
		expect(newConfig.update).not.toHaveBeenCalledWith("enableCodeActions", expect.anything(), expect.anything())
		expect(globalState.get(MIGRATION_FLAG)).toBe(true)
	})

	it("leaves migration flag unset if an error is thrown during copy, so it can retry", async () => {
		legacyConfig.inspect.mockReturnValue({ globalValue: "x" })
		newConfig.update.mockRejectedValueOnce(new Error("write blocked"))
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("Import" as any)

		await migrateFromRooCode(context, outputChannel as any)

		expect(globalState.get(MIGRATION_FLAG)).toBeUndefined()
		expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("Migration failed:"))
	})
})
