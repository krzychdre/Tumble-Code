// cd src && npx vitest run utils/__tests__/pathUtils.spec.ts
// Real directories and symlinks in a temporary folder; only the workspace folder list is a stand-in.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import { isPathOutsideWorkspace } from "../pathUtils"

let root: string
let workspace: string
let outside: string

beforeAll(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "path-utils-")))
	workspace = path.join(root, "ws")
	outside = path.join(root, "outside")
	await fs.mkdir(path.join(workspace, "src"), { recursive: true })
	await fs.mkdir(outside)
	await fs.writeFile(path.join(workspace, "src", "a.ts"), "a")
	await fs.writeFile(path.join(outside, "secret.txt"), "SECRET")
	await fs.symlink(path.join(outside, "secret.txt"), path.join(workspace, "looks-local.txt"))
	await fs.symlink(outside, path.join(workspace, "docs"), "dir")
	await fs.symlink(path.join(workspace, "src"), path.join(workspace, "src-alias"), "dir")
	// A workspace opened through a symlinked path.
	await fs.symlink(workspace, path.join(root, "ws-link"), "dir")
})

afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

const openWorkspace = (folder: string) =>
	vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([{ uri: { fsPath: folder } }] as any)

afterEach(() => vi.restoreAllMocks())

describe("isPathOutsideWorkspace", () => {
	it.each([
		["a file", "src/a.ts"],
		["the folder itself", "."],
		["a file still to be written", "src/new/file.ts"],
		["a symlink that stays inside", "src-alias/a.ts"],
	])("keeps %s inside", (_label, relPath) => {
		openWorkspace(workspace)
		expect(isPathOutsideWorkspace(path.join(workspace, relPath))).toBe(false)
	})

	it.each([
		["a ../ traversal", "../outside/secret.txt"],
		["a symlinked file pointing outside", "looks-local.txt"],
		["a file under a symlinked folder pointing outside", "docs/secret.txt"],
		["a new file under a symlinked folder pointing outside", "docs/new.txt"],
	])("puts %s outside", (_label, relPath) => {
		openWorkspace(workspace)
		expect(isPathOutsideWorkspace(path.join(workspace, relPath))).toBe(true)
	})

	it("follows a workspace opened through a symlink", () => {
		const linked = path.join(root, "ws-link")
		openWorkspace(linked)
		expect(isPathOutsideWorkspace(path.join(linked, "src", "a.ts"))).toBe(false)
		expect(isPathOutsideWorkspace(path.join(linked, "docs", "secret.txt"))).toBe(true)
	})

	it("puts everything outside without a workspace folder", () => {
		vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(undefined)
		expect(isPathOutsideWorkspace(path.join(workspace, "src", "a.ts"))).toBe(true)
	})
})
