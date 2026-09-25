import * as path from "path"
import * as fs from "fs"

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import * as childProcess from "child_process"

import { fakeRg } from "../../ripgrep/__tests__/fake-rg-process"

// Mock Package
vi.mock("../../../shared/package", () => ({
	Package: {
		name: "tumble-code",
		publisher: "QUB-IT",
		version: "1.0.0",
		outputChannel: "Tumble-Code",
	},
}))

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
	env: {
		appRoot: "/mock/app/root",
	},
}))

// Mock getBinPath
vi.mock("../../ripgrep", () => ({
	getBinPath: vi.fn(async () => require("path").resolve("/mock/bin/rg")),
}))

// Spy on the fs calls searchWorkspaceFiles makes to verify result types.
vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>()
	return {
		...actual,
		existsSync: vi.fn(),
		lstatSync: vi.fn(),
		promises: { ...actual.promises, lstat: vi.fn() },
	}
})

// Mock child_process
vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

describe("file-search", () => {
	describe("configuration integration", () => {
		it("should read VSCode search configuration settings", async () => {
			const mockSearchConfig = {
				get: vi.fn((key: string) => {
					if (key === "useIgnoreFiles") return false
					if (key === "useGlobalIgnoreFiles") return false
					if (key === "useParentIgnoreFiles") return false
					return undefined
				}),
			}
			const mockRooConfig = {
				get: vi.fn(() => 10000),
			}

			;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
				if (section === "search") return mockSearchConfig
				if (section === "tumble-code") return mockRooConfig
				return { get: vi.fn() }
			})

			// Import the module - this will call getConfiguration during import
			await import("../file-search")

			// Verify that configuration is accessible
			expect(vscode.workspace.getConfiguration).toBeDefined()
		})

		it("should read maximumIndexedFilesForFileSearch configuration", async () => {
			const { Package } = await import("../../../shared/package")
			const mockRooConfig = {
				get: vi.fn((key: string, defaultValue: number) => {
					if (key === "maximumIndexedFilesForFileSearch") return 50000
					return defaultValue
				}),
			}

			;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
				if (section === Package.name) return mockRooConfig
				return { get: vi.fn() }
			})

			// The configuration should be readable
			const config = vscode.workspace.getConfiguration(Package.name)
			const limit = config.get("maximumIndexedFilesForFileSearch", 10000)

			expect(limit).toBe(50000)
		})

		it("should use default limit when configuration is not provided", async () => {
			const { Package } = await import("../../../shared/package")
			const mockRooConfig = {
				get: vi.fn((key: string, defaultValue: number) => defaultValue),
			}

			;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
				if (section === Package.name) return mockRooConfig
				return { get: vi.fn() }
			})

			const config = vscode.workspace.getConfiguration(Package.name)
			const limit = config.get("maximumIndexedFilesForFileSearch", 10000)

			expect(limit).toBe(10000)
		})
	})
})

describe("executeRipgrep", () => {
	const mockSpawn = vi.mocked(childProcess.spawn)
	const workspacePath = path.resolve("/work")

	beforeEach(() => {
		mockSpawn.mockReset()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("returns files and their parent folders", async () => {
		const { executeRipgrep } = await import("../file-search")
		mockSpawn.mockReturnValue(fakeRg({ stdout: [path.join(workspacePath, "src", "a.ts") + "\n"] }) as any)

		const results = await executeRipgrep({ args: ["--files", workspacePath], workspacePath })

		expect(results).toEqual([
			{ path: path.join("src", "a.ts"), type: "file", label: "a.ts" },
			{ path: "src", type: "folder", label: "src" },
		])
	})

	it("returns an empty list when ripgrep only warns on stderr and exits 0", async () => {
		const { executeRipgrep } = await import("../file-search")
		mockSpawn.mockReturnValue(fakeRg({ stderr: ["rg: ./dangling: No such file or directory\n"] }) as any)

		await expect(executeRipgrep({ args: ["--files", workspacePath], workspacePath })).resolves.toEqual([])
	})

	it("rejects with ripgrep's message when it exits 2 without output", async () => {
		const { executeRipgrep } = await import("../file-search")
		mockSpawn.mockReturnValue(
			fakeRg({ stderr: ["rg: /nope: IO error: No such file or directory\n"], exitCode: 2 }) as any,
		)

		await expect(executeRipgrep({ args: ["--files", "/nope"], workspacePath })).rejects.toThrow(
			"No such file or directory",
		)
	})

	it("applies the limit and kills ripgrep", async () => {
		const { executeRipgrep } = await import("../file-search")
		const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map((name) => path.join(workspacePath, name) + "\n")
		const proc = fakeRg({ stdout: [files.join("")], hang: true })
		mockSpawn.mockReturnValue(proc as any)

		const results = await executeRipgrep({ args: ["--files", workspacePath], workspacePath, limit: 2 })

		expect(results.map((r) => r.path)).toEqual(["a.ts", "b.ts"])
		expect(proc.kill).toHaveBeenCalled()
	})

	it("kills a hanging ripgrep after the timeout and returns what it found", async () => {
		const { executeRipgrep, FILE_SEARCH_TIMEOUT_MS } = await import("../file-search")
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		const proc = fakeRg({ stdout: [path.join(workspacePath, "a.ts") + "\n"], hang: true })
		mockSpawn.mockReturnValue(proc as any)

		const pending = executeRipgrep({ args: ["--files", workspacePath], workspacePath })
		for (let i = 0; i < 20 && mockSpawn.mock.calls.length === 0; i++) {
			await new Promise((resolve) => setImmediate(resolve))
		}
		expect(mockSpawn).toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(FILE_SEARCH_TIMEOUT_MS + 1)

		const results = await pending
		expect(results.map((r) => r.path)).toEqual(["a.ts"])
		expect(proc.kill).toHaveBeenCalled()
	})
})

describe("searchWorkspaceFiles", () => {
	const mockSpawn = vi.mocked(childProcess.spawn)
	const workspacePath = path.resolve("/work")

	beforeEach(() => {
		mockSpawn.mockReset()
		vi.mocked(fs.existsSync).mockReset()
		vi.mocked(fs.lstatSync).mockReset()
		vi.mocked(fs.promises.lstat).mockReset()
		;(vscode.workspace.getConfiguration as any).mockImplementation(() => ({
			get: (_key: string, defaultValue?: unknown) => defaultValue,
		}))
	})

	afterEach(async () => {
		const { clearWorkspaceFileListCache } = await import("../file-search")
		clearWorkspaceFileListCache()
		vi.useRealTimers()
	})

	it("checks result types with async fs calls, never the sync ones", async () => {
		const { searchWorkspaceFiles } = await import("../file-search")
		mockSpawn.mockReturnValue(
			fakeRg({ stdout: [path.join(workspacePath, "src", "alpha.ts") + "\n"] }) as any,
		)
		vi.mocked(fs.promises.lstat).mockImplementation(async (p) => {
			return { isDirectory: () => String(p) === path.join(workspacePath, "src") } as any
		})

		const results = await searchWorkspaceFiles("alpha", workspacePath)

		expect(results).toContainEqual({ path: "src/alpha.ts", type: "file", label: "alpha.ts" })
		expect(fs.promises.lstat).toHaveBeenCalled()
		expect(fs.existsSync).not.toHaveBeenCalled()
		expect(fs.lstatSync).not.toHaveBeenCalled()
	})

	it("keeps the ripgrep type when the path vanished before lstat", async () => {
		const { searchWorkspaceFiles } = await import("../file-search")
		mockSpawn.mockReturnValue(fakeRg({ stdout: [path.join(workspacePath, "gone.ts") + "\n"] }) as any)
		vi.mocked(fs.promises.lstat).mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))

		const results = await searchWorkspaceFiles("gone", workspacePath)

		expect(results).toEqual([{ path: "gone.ts", type: "file", label: "gone.ts" }])
	})

	describe("workspace file list cache", () => {
		const other = path.resolve("/elsewhere")

		/** Every spawn answers with the given files under `root`, as absolute paths. */
		function rgListing(root: string, ...files: string[]) {
			return fakeRg({ stdout: [files.map((f) => path.join(root, f) + "\n").join("")] }) as any
		}

		function spawnArgs(call: number): string[] {
			return mockSpawn.mock.calls[call][1] as string[]
		}

		beforeEach(() => {
			vi.mocked(fs.promises.lstat).mockResolvedValue({ isDirectory: () => false } as any)
		})

		it("walks the workspace with the same ignore rules and limit as before (pin)", async () => {
			const { searchWorkspaceFiles } = await import("../file-search")
			const limits: unknown[] = []
			;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => ({
				get: (key: string, defaultValue?: unknown) => {
					if (section === "search" && key === "useIgnoreFiles") return false
					if (key === "maximumIndexedFilesForFileSearch") {
						limits.push(defaultValue)
						return 2
					}
					return defaultValue
				},
			}))
			const proc = fakeRg({
				stdout: [["a.ts", "b.ts", "c.ts"].map((f) => path.join(workspacePath, f) + "\n").join("")],
				hang: true,
			})
			mockSpawn.mockReturnValue(proc as any)

			const results = await searchWorkspaceFiles("", workspacePath)

			expect(spawnArgs(0)).toEqual([
				"--files",
				"--follow",
				"--hidden",
				"--no-ignore",
				"-g",
				"!**/node_modules/**",
				"-g",
				"!**/.git/**",
				"-g",
				"!**/out/**",
				"-g",
				"!**/dist/**",
				workspacePath,
			])
			expect(limits).toEqual([10000])
			expect(results.map((r) => r.path)).toEqual(["a.ts", "b.ts"])
			expect(proc.kill).toHaveBeenCalled()
		})

		it("reuses one walk for the queries of a typed word", async () => {
			const { searchWorkspaceFiles } = await import("../file-search")
			mockSpawn.mockImplementation(() => rgListing(workspacePath, "src/mention.ts", "src/other.ts"))

			for (const query of ["m", "me", "men", "ment", "menti", "mentio", "mention"]) {
				await searchWorkspaceFiles(query, workspacePath)
			}
			const results = await searchWorkspaceFiles("mention", workspacePath)

			expect(mockSpawn).toHaveBeenCalledTimes(1)
			expect(results[0]).toEqual({ path: "src/mention.ts", type: "file", label: "mention.ts" })
		})

		it("shares one walk between queries that arrive while the cache is cold", async () => {
			const { searchWorkspaceFiles } = await import("../file-search")
			mockSpawn.mockImplementation(() => rgListing(workspacePath, "alpha.ts", "beta.ts"))

			const [first, second] = await Promise.all([
				searchWorkspaceFiles("alpha", workspacePath),
				searchWorkspaceFiles("beta", workspacePath),
			])

			expect(mockSpawn).toHaveBeenCalledTimes(1)
			expect(first.map((r) => r.path)).toEqual(["alpha.ts"])
			expect(second.map((r) => r.path)).toEqual(["beta.ts"])
		})

		it("walks again after a file is created or deleted inside the workspace", async () => {
			const { searchWorkspaceFiles, noteWorkspaceFileEvent } = await import("../file-search")
			mockSpawn.mockImplementationOnce(() => rgListing(workspacePath, "old.ts"))
			mockSpawn.mockImplementationOnce(() => rgListing(workspacePath, "old.ts", "fresh.ts"))
			mockSpawn.mockImplementationOnce(() => rgListing(workspacePath, "fresh.ts"))

			expect((await searchWorkspaceFiles("fresh", workspacePath)).map((r) => r.path)).toEqual([])

			noteWorkspaceFileEvent("create", path.join(workspacePath, "fresh.ts"))
			expect((await searchWorkspaceFiles("fresh", workspacePath)).map((r) => r.path)).toEqual(["fresh.ts"])

			noteWorkspaceFileEvent("delete", path.join(workspacePath, "old.ts"))
			expect((await searchWorkspaceFiles("old", workspacePath)).map((r) => r.path)).toEqual([])
			expect(mockSpawn).toHaveBeenCalledTimes(3)
		})

		it("keeps the list for events ripgrep never lists, outside the workspace, or plain edits", async () => {
			const { searchWorkspaceFiles, noteWorkspaceFileEvent } = await import("../file-search")
			mockSpawn.mockImplementation(() => rgListing(workspacePath, "a.ts"))

			await searchWorkspaceFiles("a", workspacePath)
			noteWorkspaceFileEvent("create", path.join(workspacePath, "node_modules", "pkg", "index.js"))
			noteWorkspaceFileEvent("create", path.join(workspacePath, "src", "dist", "bundle.js"))
			noteWorkspaceFileEvent("delete", path.join(workspacePath, ".git", "index.lock"))
			noteWorkspaceFileEvent("create", path.join(other, "b.ts"))
			noteWorkspaceFileEvent("change", path.join(workspacePath, "a.ts"))
			await searchWorkspaceFiles("a", workspacePath)

			expect(mockSpawn).toHaveBeenCalledTimes(1)
		})

		it("walks again after an ignore file changes, even one above the workspace", async () => {
			const { searchWorkspaceFiles, noteWorkspaceFileEvent } = await import("../file-search")
			mockSpawn.mockImplementation(() => rgListing(workspacePath, "a.ts"))

			await searchWorkspaceFiles("a", workspacePath)
			noteWorkspaceFileEvent("change", path.join(workspacePath, "src", ".gitignore"))
			await searchWorkspaceFiles("a", workspacePath)
			noteWorkspaceFileEvent("change", path.join(path.dirname(workspacePath), ".ignore"))
			await searchWorkspaceFiles("a", workspacePath)

			expect(mockSpawn).toHaveBeenCalledTimes(3)
		})

		it("walks again after the time to live, as a backstop for events the watcher misses", async () => {
			const { searchWorkspaceFiles, WORKSPACE_FILE_LIST_TTL_MS } = await import("../file-search")
			vi.useFakeTimers({ toFake: ["Date"] })
			mockSpawn.mockImplementation(() => rgListing(workspacePath, "a.ts"))

			await searchWorkspaceFiles("a", workspacePath)
			vi.setSystemTime(Date.now() + WORKSPACE_FILE_LIST_TTL_MS - 1)
			await searchWorkspaceFiles("a", workspacePath)
			vi.setSystemTime(Date.now() + 2)
			await searchWorkspaceFiles("a", workspacePath)

			expect(mockSpawn).toHaveBeenCalledTimes(2)
		})

		it("walks again when the ignore settings change", async () => {
			const { searchWorkspaceFiles } = await import("../file-search")
			let useIgnoreFiles = true
			;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => ({
				get: (key: string, defaultValue?: unknown) =>
					section === "search" && key === "useIgnoreFiles" ? useIgnoreFiles : defaultValue,
			}))
			mockSpawn.mockImplementation(() => rgListing(workspacePath, "a.ts"))

			await searchWorkspaceFiles("a", workspacePath)
			useIgnoreFiles = false
			await searchWorkspaceFiles("a", workspacePath)

			expect(mockSpawn).toHaveBeenCalledTimes(2)
			expect(spawnArgs(0)).not.toContain("--no-ignore")
			expect(spawnArgs(1)).toContain("--no-ignore")
		})

		it("keeps one list per workspace root", async () => {
			const { searchWorkspaceFiles } = await import("../file-search")
			mockSpawn.mockImplementation((_bin: any, args: any) => {
				const root = (args as string[])[(args as string[]).length - 1]
				return rgListing(root, root === other ? "there.ts" : "here.ts")
			})

			expect((await searchWorkspaceFiles("", workspacePath)).map((r) => r.path)).toEqual(["here.ts"])
			expect((await searchWorkspaceFiles("", other)).map((r) => r.path)).toEqual(["there.ts"])
			expect((await searchWorkspaceFiles("", workspacePath)).map((r) => r.path)).toEqual(["here.ts"])
			expect(mockSpawn).toHaveBeenCalledTimes(2)
		})

		it("does not keep a failed walk", async () => {
			const { searchWorkspaceFiles } = await import("../file-search")
			vi.spyOn(console, "error").mockImplementation(() => {})
			mockSpawn.mockImplementationOnce(
				() => fakeRg({ stderr: ["rg: IO error\n"], exitCode: 2 }) as any,
			)
			mockSpawn.mockImplementationOnce(() => rgListing(workspacePath, "a.ts"))

			expect(await searchWorkspaceFiles("a", workspacePath)).toEqual([])
			expect((await searchWorkspaceFiles("a", workspacePath)).map((r) => r.path)).toEqual(["a.ts"])
			expect(mockSpawn).toHaveBeenCalledTimes(2)
		})
	})
})
