import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"

import { memoryWriteSandbox, filterMemoryWrittenPaths } from "../memorySandbox"
import { initMemoryPaths, resetMemoryPaths, getAutoMemPath } from "../paths"

describe("memorySandbox", () => {
	let tmpBase: string
	const cwd = "/fake/cwd"
	let memDir: string

	beforeEach(async () => {
		tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "roo-sandbox-"))
		initMemoryPaths(tmpBase, () => ({ autoMemoryEnabled: true }))
		memDir = getAutoMemPath(cwd)
	})

	afterEach(async () => {
		resetMemoryPaths()
		await fs.rm(tmpBase, { recursive: true, force: true })
	})

	const toolAsk = (tool: string, p?: string) => JSON.stringify({ tool, path: p })

	describe("memoryWriteSandbox", () => {
		it("denies command / mcp asks (capabilities the memory agent never needs)", () => {
			const decide = memoryWriteSandbox(cwd)
			expect(decide("command", "ls")).toBe("deny")
			expect(decide("use_mcp_server", "{}")).toBe("deny")
		})

		it("approves non-tool asks so the autonomous task never blocks", () => {
			const decide = memoryWriteSandbox(cwd)
			expect(decide("followup", "which file?")).toBe("approve")
			expect(decide("completion_result", "done")).toBe("approve")
			expect(decide("resume_task", "")).toBe("approve")
		})

		it("approves read-only tool actions anywhere", () => {
			const decide = memoryWriteSandbox(cwd)
			expect(decide("tool", toolAsk("readFile", "/some/other/file.ts"))).toBe("approve")
			expect(decide("tool", toolAsk("searchFiles", "/anywhere"))).toBe("approve")
			expect(decide("tool", toolAsk("listFilesRecursive", "/anywhere"))).toBe("approve")
		})

		it("approves writes inside the memory directory", () => {
			const decide = memoryWriteSandbox(cwd)
			expect(decide("tool", toolAsk("newFileCreated", path.join(memDir, "user.md")))).toBe("approve")
			expect(decide("tool", toolAsk("editedExistingFile", path.join(memDir, "MEMORY.md")))).toBe("approve")
		})

		it("denies writes outside the memory directory", () => {
			const decide = memoryWriteSandbox(cwd)
			expect(decide("tool", toolAsk("newFileCreated", "/workspace/src/evil.ts"))).toBe("deny")
			expect(decide("tool", toolAsk("editedExistingFile", "../../etc/passwd"))).toBe("deny")
		})

		it("denies write actions that carry no path", () => {
			const decide = memoryWriteSandbox(cwd)
			expect(decide("tool", toolAsk("newFileCreated", undefined))).toBe("deny")
			expect(decide("tool", JSON.stringify({ tool: "appliedDiff" }))).toBe("deny")
		})

		it("denies an unparseable tool ask (fail-safe: a malformed write must not bypass containment)", () => {
			const decide = memoryWriteSandbox(cwd)
			expect(decide("tool", "not json")).toBe("deny")
			expect(decide("tool", "{invalid")).toBe("deny")
		})

		it("never returns undefined (would hang a non-current background task)", () => {
			const decide = memoryWriteSandbox(cwd)
			for (const ask of ["tool", "command", "followup", "completion_result", "api_req_failed"]) {
				expect(["approve", "deny"]).toContain(decide(ask, "{}"))
			}
		})

		it("denies when a path-bearing field other than `path` points outside the memory dir", () => {
			const decide = memoryWriteSandbox(cwd)
			// `path` is inside memory dir, but a hypothetical `file_path` points outside.
			const inside = path.join(memDir, "user.md")
			const ask = JSON.stringify({ tool: "newFileCreated", path: inside, file_path: "/workspace/src/evil.ts" })
			expect(decide("tool", ask)).toBe("deny")
		})

		it("approves when all path-bearing fields point inside the memory dir", () => {
			const decide = memoryWriteSandbox(cwd)
			const inside = path.join(memDir, "user.md")
			const inside2 = path.join(memDir, "other.md")
			const ask = JSON.stringify({ tool: "newFileCreated", path: inside, file_path: inside2 })
			expect(decide("tool", ask)).toBe("approve")
		})

		it("denies when a path inside an array of objects (files: [{path}]) points outside the memory dir", () => {
			const decide = memoryWriteSandbox(cwd)
			const inside = path.join(memDir, "user.md")
			const ask = JSON.stringify({
				tool: "newFileCreated",
				path: inside,
				files: [{ path: "/workspace/src/evil.ts" }],
			})
			expect(decide("tool", ask)).toBe("deny")
		})

		it("approves when array-of-objects paths are all inside the memory dir", () => {
			const decide = memoryWriteSandbox(cwd)
			const inside = path.join(memDir, "user.md")
			const inside2 = path.join(memDir, "other.md")
			const ask = JSON.stringify({ tool: "newFileCreated", path: inside, files: [{ path: inside2 }] })
			expect(decide("tool", ask)).toBe("approve")
		})

		it("does not flag read-only pattern fields (regex, searchPattern, filePattern) even if they contain path-like strings", () => {
			const decide = memoryWriteSandbox(cwd)
			const inside = path.join(memDir, "user.md")
			const ask = JSON.stringify({
				tool: "newFileCreated",
				path: inside,
				regex: "/workspace/src/secret.ts",
				searchPattern: "/etc/passwd",
				filePattern: "../../etc",
			})
			expect(decide("tool", ask)).toBe("approve")
		})
	})

	describe("filterMemoryWrittenPaths", () => {
		it("keeps only paths inside the memory dir and resolves relative paths", () => {
			const inside = path.join(memDir, "feedback.md")
			const result = filterMemoryWrittenPaths([inside, "/workspace/src/foo.ts", "unrelated.txt"], cwd)
			expect(result).toEqual([inside])
		})

		it("returns [] when nothing was written to the memory dir", () => {
			expect(filterMemoryWrittenPaths(["/workspace/a.ts", "b.ts"], cwd)).toEqual([])
		})
	})
})
