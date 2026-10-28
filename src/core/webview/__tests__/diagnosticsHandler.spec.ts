// npx vitest src/core/webview/__tests__/diagnosticsHandler.spec.ts
// Real files in a temporary storage directory; only the editor is a stand-in.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import * as vscode from "vscode"

import { logger } from "../../../utils/logging"
import { generateErrorDiagnostics } from "../diagnosticsHandler"

let storage: string

beforeEach(async () => {
	storage = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostics-spec-"))
	// The editor's side: the vscode stand-in has no documents to open.
	Object.assign(vscode.workspace, { openTextDocument: vi.fn(async () => ({})) })
	Object.assign(vscode.window, { showTextDocument: vi.fn(async () => ({})), showErrorMessage: vi.fn() })
})

afterEach(async () => {
	vi.restoreAllMocks()
	await fs.rm(storage, { recursive: true, force: true })
})

async function writeHistory(taskId: string, content: string) {
	const dir = path.join(storage, "tasks", taskId)
	await fs.mkdir(dir, { recursive: true })
	await fs.writeFile(path.join(dir, "api_conversation_history.json"), content)
}

describe("generateErrorDiagnostics", () => {
	it("writes the error metadata and history to a file only the user can read, and opens it", async () => {
		await writeHistory("test-task-id", '[{"role": "user", "content": "test"}]')

		const result = await generateErrorDiagnostics({
			taskId: "test-task-id",
			globalStoragePath: storage,
			values: {
				timestamp: "2025-01-01T00:00:00.000Z",
				version: "1.2.3",
				provider: "test-provider",
				model: "test-model",
				details: "Sample error details",
			},
		})

		expect(result.success).toBe(true)
		// taskId.slice(0, 8) = "test-tas" from "test-task-id"
		expect(path.basename(result.filePath!)).toMatch(/^roo-diagnostics-test-tas-\d+\.json$/)
		const written = await fs.readFile(result.filePath!, "utf8")
		expect(written).toContain(
			"// Please share this file with the Tumble Code maintainers to diagnose the issue faster",
		)
		expect(written).toContain('"version": "1.2.3"')
		expect(written).toContain('"provider": "test-provider"')
		expect(written).toContain('"model": "test-model"')
		expect(written).toContain('"details": "Sample error details"')
		expect(written).toContain('"content": "test"')
		if (process.platform !== "win32") {
			expect((await fs.stat(result.filePath!)).mode & 0o777).toBe(0o600)
			expect((await fs.stat(path.dirname(result.filePath!))).mode & 0o777).toBe(0o700)
		}
		expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(result.filePath)
		expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1)
	})

	it("uses empty history and default values when there is no history file", async () => {
		const result = await generateErrorDiagnostics({ taskId: "no-history", globalStoragePath: storage })

		expect(result.success).toBe(true)
		const written = await fs.readFile(result.filePath!, "utf8")
		expect(written).toContain('"history": []')
		expect(written).toContain('"version": ""')
		expect(written).toContain('"provider": ""')
		expect(written).toContain('"model": ""')
		expect(written).toContain('"details": ""')
	})

	it("handles a history file that is not JSON", async () => {
		await writeHistory("bad-json", "invalid json")

		const result = await generateErrorDiagnostics({ taskId: "bad-json", globalStoragePath: storage })

		expect(result.success).toBe(true)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Failed to parse api_conversation_history.json")
		expect(await fs.readFile(result.filePath!, "utf8")).toContain('"history": []')
	})

	it("returns an error result when the task's storage cannot be used", async () => {
		const notADirectory = path.join(storage, "file")
		await fs.writeFile(notADirectory, "")
		const loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => {})

		const result = await generateErrorDiagnostics({ taskId: "t", globalStoragePath: notADirectory })

		expect(result.success).toBe(false)
		expect(result.error).toMatch(/ENOTDIR|EEXIST/)
		expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/^Error generating diagnostics: /))
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringMatching(/^Failed to generate diagnostics: /),
		)
	})
})
