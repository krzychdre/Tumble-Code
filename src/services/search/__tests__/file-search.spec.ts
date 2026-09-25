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
})
