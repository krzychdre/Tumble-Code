// npx vitest core/ignore/__tests__/RooIgnoreController.spec.ts

import { RooIgnoreController, LOCK_TEXT_SYMBOL } from "../RooIgnoreController"
import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import { fileExistsAtPath } from "../../../utils/fs"
import { logger } from "../../../utils/logging"

vi.mock("fs/promises")
vi.mock("fs")
vi.mock("../../../utils/fs")

vi.mock("vscode", () => ({
	workspace: { createFileSystemWatcher: vi.fn() },
	RelativePattern: vi.fn().mockImplementation(function (base, pattern) {
		return { base, pattern }
	}),
}))

const TEST_CWD = "/test/path"
const PATTERNS = "node_modules\n.git\nsecrets/**\n*.log"

const mockFileExists = vi.mocked(fileExistsAtPath)
const mockReadFile = vi.mocked(fs.readFile)

describe("RooIgnoreController", () => {
	let controller: RooIgnoreController
	let mockWatcher: {
		onDidCreate: ReturnType<typeof vi.fn>
		onDidChange: ReturnType<typeof vi.fn>
		onDidDelete: ReturnType<typeof vi.fn>
		dispose: ReturnType<typeof vi.fn>
	}

	async function loadWith(content: string | undefined) {
		mockFileExists.mockResolvedValue(content !== undefined)
		if (content !== undefined) {
			mockReadFile.mockResolvedValue(content)
		}
		await controller.initialize()
	}

	beforeEach(() => {
		vi.clearAllMocks()
		mockWatcher = {
			onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			dispose: vi.fn(),
		}
		vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(mockWatcher as any)
		vi.mocked(fsSync.realpathSync).mockImplementation((filePath) => filePath.toString())
		controller = new RooIgnoreController(TEST_CWD)
	})

	describe("loading .rooignore", () => {
		it("reads .rooignore from cwd and applies its patterns", async () => {
			await loadWith("node_modules\nsecrets.json")

			expect(mockReadFile).toHaveBeenCalledWith(path.join(TEST_CWD, ".rooignore"), "utf8")
			expect(controller.rooIgnoreContent).toBe("node_modules\nsecrets.json")
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess("secrets.json")).toBe(false)
			expect(controller.validateAccess("src/app.ts")).toBe(true)
		})

		it("also hides .rooignore itself", async () => {
			await loadWith("node_modules")

			expect(controller.validateAccess(".rooignore")).toBe(false)
		})

		it("allows everything when .rooignore does not exist", async () => {
			await loadWith(undefined)

			expect(controller.rooIgnoreContent).toBeUndefined()
			expect(controller.validateAccess("node_modules/package.json")).toBe(true)
			expect(controller.validateCommand("cat node_modules/package.json")).toBeUndefined()
			expect(controller.getInstructions()).toBeUndefined()
		})

		it("logs and keeps going when reading .rooignore fails", async () => {
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockRejectedValue(new Error("Test file read error"))
			const loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => {})

			await controller.initialize()

			expect(loggerErrorSpy).toHaveBeenCalledWith("Unexpected error loading .rooignore:", expect.any(Error))
			loggerErrorSpy.mockRestore()
		})

		it("replaces the previous patterns on reload instead of adding to them", async () => {
			await loadWith("node_modules")
			await loadWith(".git")

			expect(controller.validateAccess("node_modules/package.json")).toBe(true)
			expect(controller.validateAccess(".git/config")).toBe(false)
		})
	})

	describe("file watcher", () => {
		it("watches .rooignore in cwd", () => {
			expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith({
				base: TEST_CWD,
				pattern: ".rooignore",
			})
		})

		it.each(["onDidCreate", "onDidChange"] as const)("reloads the patterns on %s", async (event) => {
			await loadWith(undefined)
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules")

			mockWatcher[event].mock.calls[0][0]()

			await vi.waitFor(() => expect(controller.rooIgnoreContent).toBe("node_modules"))
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
		})

		it("allows everything again on onDidDelete", async () => {
			await loadWith("node_modules")
			mockFileExists.mockResolvedValue(false)

			mockWatcher.onDidDelete.mock.calls[0][0]()

			await vi.waitFor(() => expect(controller.rooIgnoreContent).toBeUndefined())
			expect(controller.validateAccess("node_modules/package.json")).toBe(true)
		})

		it("dispose releases the watcher and its listeners", () => {
			controller.dispose()

			expect(mockWatcher.dispose).toHaveBeenCalledTimes(1)
			for (const event of ["onDidCreate", "onDidChange", "onDidDelete"] as const) {
				expect(mockWatcher[event].mock.results[0].value.dispose).toHaveBeenCalledTimes(1)
			}
		})
	})

	describe("validateAccess", () => {
		beforeEach(() => loadWith(PATTERNS))

		it.each([
			["an absolute path inside cwd", path.join(TEST_CWD, "node_modules/package.json"), false],
			["an allowed absolute path inside cwd", path.join(TEST_CWD, "src/app.ts"), true],
			["a traversal that lands in an ignored directory", "public/css/../../secrets/keys.json", false],
			["a traversal that lands in an allowed directory", "public/css/../../public/app.js", true],
			["a relative path outside cwd", "../outside-project/secrets/keys.json", true],
			["an absolute path outside cwd", "/etc/hosts", true],
		])("judges %s", (_label, filePath, allowed) => {
			expect(controller.validateAccess(filePath)).toBe(allowed)
		})

		it("blocks a symlink that points into an ignored path", () => {
			vi.mocked(fsSync.realpathSync).mockImplementation((filePath) =>
				filePath.toString().endsWith("config.json")
					? path.join(TEST_CWD, "node_modules/package.json")
					: filePath.toString(),
			)

			expect(controller.validateAccess("config.json")).toBe(false)
		})

		it("uses the path itself when the symlink cannot be resolved", () => {
			vi.mocked(fsSync.realpathSync).mockImplementation(() => {
				throw new Error("ENOENT")
			})

			expect(controller.validateAccess("secrets/keys.json")).toBe(false)
			expect(controller.validateAccess("src/app.ts")).toBe(true)
		})
	})

	describe("validateCommand", () => {
		beforeEach(() => loadWith(PATTERNS))

		it.each([
			["cat node_modules/package.json", "node_modules/package.json"],
			["cat -n node_modules/package.json", "node_modules/package.json"],
			["grep pattern src/app.ts node_modules/index.js", "node_modules/index.js"],
			["head -n 5 app.log secrets/keys.json", "app.log"],
			["cat secrets/creds.json | grep password", "secrets/creds.json"],
			["Get-Content -Path secrets/api-keys.json -Raw", "secrets/api-keys.json"],
			["GC secrets/keys.json", "secrets/keys.json"],
			["sls 'api-key' app.log", "app.log"],
			// Quoting, absolute paths and expansions name the same file.
			['cat "secrets/key.txt"', "secrets/key.txt"],
			["cat 'secrets/key.txt'", "secrets/key.txt"],
			[`cat ${TEST_CWD}/secrets/key.txt`, `${TEST_CWD}/secrets/key.txt`],
			["cat $(pwd)/secrets/key.txt", "secrets/key.txt"],
			["cat ${PWD}/secrets/key.txt", "secrets/key.txt"],
			["cat secrets/*", "secrets/*"],
			["cat < secrets/key.txt", "secrets/key.txt"],
			// The commands of a chain, of a substitution and of a wrapper.
			["cd secrets && cat key.txt", "key.txt"],
			["echo $(cat secrets/key.txt)", "secrets/key.txt"],
			["sh -c 'cat secrets/key.txt'", "secrets/key.txt"],
			["sudo cat secrets/key.txt", "secrets/key.txt"],
			["env LANG=C head secrets/key.txt", "secrets/key.txt"],
			// Copying or encoding is reading too.
			["cp secrets/key.txt /tmp/out", "secrets/key.txt"],
			["base64 secrets/key.txt", "secrets/key.txt"],
			// PowerShell: a path given as -Path:value, and a stream of the file.
			["Get-Content -Path:secrets/keys.json", "secrets/keys.json"],
			["Get-Content secrets/keys.json:Zone.Identifier", "secrets/keys.json:Zone.Identifier"],
		])("blocks %j", (command, blockedPath) => {
			expect(controller.validateCommand(command)).toBe(blockedPath)
		})

		it.each([
			["a file-reading command on allowed files", "cat src/app.ts"],
			["a command that does not read files", "ls -la node_modules"],
			["an absolute path outside the workspace", "type /secrets/keys.json"],
			["a Windows switch", "type /? app.txt"],
			["removing an ignored directory", "rm -rf node_modules && npm install"],
			["reading allowed files after cd", "cd src && cat app.ts"],
		])("allows %s", (_label, command) => {
			expect(controller.validateCommand(command)).toBeUndefined()
		})
	})

	describe("filterPaths", () => {
		beforeEach(() => loadWith(PATTERNS))

		it("drops ignored paths and keeps the order of the rest", () => {
			const paths = ["src/app.ts", "node_modules/package.json", "README.md", ".git/HEAD", "logs/error.log", "/"]

			expect(controller.filterPaths(paths)).toEqual(["src/app.ts", "README.md", "/"])
		})

		it("judges the paths themselves when their directory cannot be resolved", () => {
			vi.mocked(fsSync.realpathSync).mockImplementation(() => {
				throw new Error("ENOENT")
			})

			expect(controller.filterPaths(["secrets/keys.json", "src/app.ts"])).toEqual(["src/app.ts"])
		})

		it("fails closed and logs when a check throws", () => {
			vi.spyOn(controller, "validateAccess").mockImplementation(() => {
				throw new Error("Test error")
			})
			const loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => {})

			expect(controller.filterPaths(["file1.txt", "file2.txt"])).toEqual([])
			expect(loggerErrorSpy).toHaveBeenCalledWith("Error filtering paths:", expect.any(Error))
			loggerErrorSpy.mockRestore()
		})
	})

	it("getInstructions quotes the .rooignore content and explains the lock symbol", async () => {
		await loadWith("node_modules\nsecrets/**")

		const instructions = controller.getInstructions()

		expect(instructions).toContain("# .rooignore")
		expect(instructions).toContain(LOCK_TEXT_SYMBOL)
		expect(instructions).toContain("node_modules\nsecrets/**\n.rooignore")
	})
})
