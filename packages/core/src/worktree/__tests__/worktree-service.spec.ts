import * as path from "path"
import { execFile } from "child_process"

vi.mock("child_process", () => ({
	exec: vi.fn(),
	execFile: vi.fn(),
}))

import { WorktreeService } from "../worktree-service.js"

describe("WorktreeService", () => {
	describe("normalizePath", () => {
		let service: WorktreeService

		beforeEach(() => {
			service = new WorktreeService()
		})

		// Access private method for testing
		const callNormalizePath = (service: WorktreeService, p: string): string => {
			// @ts-expect-error - accessing private method for testing
			return service.normalizePath(p)
		}

		it("should normalize paths with trailing slashes", () => {
			const result = callNormalizePath(service, "/home/user/project/")
			expect(result).toBe(path.normalize("/home/user/project"))
		})

		it("should normalize paths with multiple trailing slashes", () => {
			const result = callNormalizePath(service, "/home/user/project///")
			// path.normalize already handles multiple slashes
			expect(result).toBe(path.normalize("/home/user/project"))
		})

		it("should preserve root path /", () => {
			// This is a critical test - the old regex would turn "/" into ""
			// On Windows, path.normalize("/") returns "\", on Unix it returns "/"
			const result = callNormalizePath(service, "/")
			expect(result).toBe(path.sep)
		})

		it("should handle paths without trailing slashes", () => {
			const result = callNormalizePath(service, "/home/user/project")
			expect(result).toBe(path.normalize("/home/user/project"))
		})

		it("should handle relative paths", () => {
			const result = callNormalizePath(service, "./some/path/")
			expect(result).toBe(path.normalize("./some/path"))
		})

		it("should handle empty string", () => {
			const result = callNormalizePath(service, "")
			expect(result).toBe(".")
		})

		it("should handle Windows-style paths on non-Windows", () => {
			// path.normalize will convert separators appropriately
			const result = callNormalizePath(service, "C:\\Users\\test\\project")
			// On Unix, this stays as-is; on Windows it would normalize
			expect(result).toBeTruthy()
		})
	})

	describe("parseWorktreeOutput", () => {
		let service: WorktreeService

		beforeEach(() => {
			service = new WorktreeService()
		})

		// Access private method for testing
		const callParseWorktreeOutput = (
			service: WorktreeService,
			output: string,
			currentCwd: string,
		): ReturnType<WorktreeService["parseWorktreeOutput"]> => {
			// @ts-expect-error - accessing private method for testing
			return service.parseWorktreeOutput(output, currentCwd)
		}

		it("should parse porcelain output correctly", () => {
			const output = `worktree /home/user/repo
HEAD abc123def456
branch refs/heads/main

worktree /home/user/repo-feature
HEAD def456abc123
branch refs/heads/feature/test
`
			const result = callParseWorktreeOutput(service, output, "/home/user/repo")

			expect(result).toHaveLength(2)
			expect(result[0]).toMatchObject({
				path: "/home/user/repo",
				branch: "main",
				commitHash: "abc123def456",
				isCurrent: true,
			})
			expect(result[1]).toMatchObject({
				path: "/home/user/repo-feature",
				branch: "feature/test",
				commitHash: "def456abc123",
				isCurrent: false,
			})
		})

		it("should handle detached HEAD worktrees", () => {
			const output = `worktree /home/user/repo-detached
HEAD abc123def456
detached
`
			const result = callParseWorktreeOutput(service, output, "/home/user/other")

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				path: "/home/user/repo-detached",
				isDetached: true,
				branch: "",
			})
		})

		it("should handle locked worktrees", () => {
			const output = `worktree /home/user/repo-locked
HEAD abc123def456
branch refs/heads/locked-branch
locked some reason here
`
			const result = callParseWorktreeOutput(service, output, "/home/user/other")

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				isLocked: true,
				lockReason: "some reason here",
			})
		})

		it("should handle bare worktrees", () => {
			const output = `worktree /home/user/repo.git
bare
`
			const result = callParseWorktreeOutput(service, output, "/home/user/other")

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				path: "/home/user/repo.git",
				isBare: true,
			})
		})
	})

	describe("hasUncommittedChanges", () => {
		let service: WorktreeService
		const mockExecFile = vi.mocked(execFile)

		beforeEach(() => {
			service = new WorktreeService()
			mockExecFile.mockReset()
		})

		// promisify(execFile) without the custom symbol resolves with the
		// second cb arg as the whole value, so we pass { stdout, stderr }.
		type ExecCb = (err: Error | null, result?: { stdout: string; stderr: string }) => void
		const mockImpl = (stdout: string) =>
			((_cmd: string, _args: string[], _opts: unknown, cb: ExecCb) => cb(null, { stdout, stderr: "" })) as never

		const mockErr = (err: Error) =>
			((_cmd: string, _args: string[], _opts: unknown, cb: ExecCb) => cb(err)) as never

		it("returns false for clean worktree (empty porcelain output)", async () => {
			mockExecFile.mockImplementation(mockImpl(""))
			expect(await service.hasUncommittedChanges("/wt")).toBe(false)
		})

		it("returns true when porcelain output has changes", async () => {
			mockExecFile.mockImplementation(mockImpl(" M file.ts\n"))
			expect(await service.hasUncommittedChanges("/wt")).toBe(true)
		})

		it("returns false for whitespace-only porcelain output", async () => {
			mockExecFile.mockImplementation(mockImpl("  \n  \n"))
			expect(await service.hasUncommittedChanges("/wt")).toBe(false)
		})

		it("returns true on exec error (errs toward keeping)", async () => {
			mockExecFile.mockImplementation(mockErr(new Error("boom")))
			expect(await service.hasUncommittedChanges("/wt")).toBe(true)
		})
	})

	describe("branchHasCommits", () => {
		let service: WorktreeService
		const mockExecFile = vi.mocked(execFile)

		beforeEach(() => {
			service = new WorktreeService()
			mockExecFile.mockReset()
		})

		type ExecCb = (err: Error | null, result?: { stdout: string; stderr: string }) => void
		const mockImpl = (stdout: string) =>
			((_cmd: string, _args: string[], _opts: unknown, cb: ExecCb) => cb(null, { stdout, stderr: "" })) as never

		const mockErr = (err: Error) =>
			((_cmd: string, _args: string[], _opts: unknown, cb: ExecCb) => cb(err)) as never

		it("returns false when count is 0", async () => {
			mockExecFile.mockImplementation(mockImpl("0\n"))
			expect(await service.branchHasCommits("/repo", "worktree/parallel-x-1")).toBe(false)
		})

		it("returns true when count > 0", async () => {
			mockExecFile.mockImplementation(mockImpl("3\n"))
			expect(await service.branchHasCommits("/repo", "worktree/parallel-x-1")).toBe(true)
		})

		it("returns true on exec error (errs toward keeping)", async () => {
			mockExecFile.mockImplementation(mockErr(new Error("boom")))
			expect(await service.branchHasCommits("/repo", "worktree/parallel-x-1")).toBe(true)
		})

		it("returns true on unparseable output (errs toward keeping)", async () => {
			mockExecFile.mockImplementation(mockImpl("fatal: not a number\n"))
			expect(await service.branchHasCommits("/repo", "worktree/parallel-x-1")).toBe(true)
		})
	})
})
