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

		it("approves an unparseable tool ask conservatively (reads are the common case)", () => {
			const decide = memoryWriteSandbox(cwd)
			expect(decide("tool", "not json")).toBe("approve")
		})

		it("never returns undefined (would hang a non-current background task)", () => {
			const decide = memoryWriteSandbox(cwd)
			for (const ask of ["tool", "command", "followup", "completion_result", "api_req_failed"]) {
				expect(["approve", "deny"]).toContain(decide(ask, "{}"))
			}
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
