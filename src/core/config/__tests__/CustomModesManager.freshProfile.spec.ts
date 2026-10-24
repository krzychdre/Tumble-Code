// A fresh profile has no custom_modes.yaml yet: getCustomModesFilePath queues
// its creation and returns before the write ran when another write is in
// flight. Real files in a temp directory; only vscode is replaced.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type * as vscode from "vscode"

import { CustomModesManager } from "../CustomModesManager"
import { logger } from "../../../utils/logging"

vi.mock("vscode", () => ({
	workspace: { workspaceFolders: [], onDidSaveTextDocument: vi.fn(), createFileSystemWatcher: vi.fn() },
	window: { showErrorMessage: vi.fn() },
}))

describe("CustomModesManager on a fresh profile", () => {
	let storage: string

	beforeEach(async () => {
		storage = await fs.mkdtemp(path.join(os.tmpdir(), "custom-modes-"))
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		// maxRetries: the queued creation may still be renaming its temp file.
		await fs.rm(storage, { recursive: true, force: true, maxRetries: 5 })
	})

	// Activation starts the file watcher (which creates the file) while the
	// first state push already reads the modes.
	it("reads no modes and logs nothing while the file is still being created", async () => {
		const context = {
			globalStorageUri: { fsPath: storage },
			globalState: { get: vi.fn(), update: vi.fn() },
		} as unknown as vscode.ExtensionContext
		const manager = new CustomModesManager(context, async () => {})
		const error = vi.spyOn(logger, "error").mockImplementation(() => {})

		const results = await Promise.all([manager.getCustomModes(), manager.getCustomModes()])

		expect(results).toEqual([[], []])
		expect(error).not.toHaveBeenCalled()
	})
})
