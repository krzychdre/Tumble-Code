// cd src && npx vitest run core/tools/__tests__/executeCommandWorkingDir.spec.ts

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import { isCommandWorkingDirInWorkspace, resolveCommandWorkingDir } from "../ExecuteCommandTool"

// The model may pick the directory a command runs in; the user sees only the command.
describe("the working directory of execute_command", () => {
	let base: string
	let workspace: string
	let otherFolder: string
	let outside: string

	beforeEach(() => {
		base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "command-cwd-")))
		workspace = path.join(base, "workspace")
		otherFolder = path.join(base, "other-folder")
		outside = path.join(base, "outside")
		for (const dir of [path.join(workspace, "src"), otherFolder, outside]) {
			fs.mkdirSync(dir, { recursive: true })
		}
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: workspace } }, { uri: { fsPath: otherFolder } }]
	})

	afterEach(() => {
		;(vscode.workspace as any).workspaceFolders = []
		fs.rmSync(base, { recursive: true, force: true })
	})

	it("resolves a relative cwd against the task's directory and keeps an absolute one", () => {
		expect(resolveCommandWorkingDir(workspace, undefined)).toBe(workspace)
		expect(resolveCommandWorkingDir(workspace, "src")).toBe(path.join(workspace, "src"))
		expect(resolveCommandWorkingDir(workspace, outside)).toBe(outside)
	})

	it("accepts the task's directory, a folder below it and another workspace folder", () => {
		expect(isCommandWorkingDirInWorkspace(workspace, workspace)).toBe(true)
		expect(isCommandWorkingDirInWorkspace(workspace, path.join(workspace, "src"))).toBe(true)
		expect(isCommandWorkingDirInWorkspace(workspace, otherFolder)).toBe(true)
	})

	it("refuses a directory outside every workspace folder, by an absolute path or by climbing out", () => {
		expect(isCommandWorkingDirInWorkspace(workspace, outside)).toBe(false)
		expect(isCommandWorkingDirInWorkspace(workspace, resolveCommandWorkingDir(workspace, "../outside"))).toBe(false)
		expect(isCommandWorkingDirInWorkspace(workspace, os.homedir())).toBe(false)
	})

	it.skipIf(process.platform === "win32")("refuses a link in the workspace that leads out of it", () => {
		fs.symlinkSync(outside, path.join(workspace, "linked"))
		expect(isCommandWorkingDirInWorkspace(workspace, path.join(workspace, "linked"))).toBe(false)
	})

	it("accepts a directory below the task's directory when the editor has no workspace folder", () => {
		;(vscode.workspace as any).workspaceFolders = []
		expect(isCommandWorkingDirInWorkspace(workspace, path.join(workspace, "src"))).toBe(true)
		expect(isCommandWorkingDirInWorkspace(workspace, outside)).toBe(false)
	})
})
