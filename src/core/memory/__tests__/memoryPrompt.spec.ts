import fs from "fs/promises"
import os from "os"
import path from "path"

import {
	truncateEntrypointContent,
	buildMemoryLines,
	buildSearchingPastContextSection,
	MAX_ENTRYPOINT_LINES,
	MAX_ENTRYPOINT_BYTES,
	loadMemoryIndex,
	loadMemoryPrompt,
} from "../memoryPrompt"
import { initMemoryPaths, resetMemoryPaths } from "../paths"

describe("memoryPrompt", () => {
	describe("truncateEntrypointContent", () => {
		it("returns content unchanged when under both caps", () => {
			const t = truncateEntrypointContent("line1\nline2")
			expect(t.wasLineTruncated).toBe(false)
			expect(t.wasByteTruncated).toBe(false)
			expect(t.content).toBe("line1\nline2")
		})

		it("truncates by line count and appends a warning", () => {
			const lines = Array.from({ length: MAX_ENTRYPOINT_LINES + 50 }, (_, i) => `line ${i}`)
			const t = truncateEntrypointContent(lines.join("\n"))
			expect(t.wasLineTruncated).toBe(true)
			expect(t.content).toContain("WARNING: MEMORY.md is")
			expect(t.content).toContain(`${MAX_ENTRYPOINT_LINES} lines`)
		})

		it("truncates by byte count, cutting at the last newline under the cap", () => {
			const big = "x".repeat(MAX_ENTRYPOINT_BYTES + 1000)
			const t = truncateEntrypointContent(big)
			expect(t.wasByteTruncated).toBe(true)
			expect(t.content.length).toBeLessThanOrEqual(MAX_ENTRYPOINT_BYTES + 200) // + warning suffix
			expect(t.content).toContain("WARNING: MEMORY.md is")
		})
	})

	describe("buildMemoryLines", () => {
		it("names the directory and the Roo tool names (not Claude Code's)", () => {
			const lines = buildMemoryLines("auto memory", "/mem/dir/", "/proj")
			const blob = lines.join("\n")
			expect(blob).toContain("/mem/dir/")
			// Roo tool names — NOT Claude Code's Write/Grep/Glob. The how-to-save
			// section names write_to_file (via DIR_EXISTS_GUIDANCE); the
			// search-past-context section names search_files. Other tools
			// (read_file/edit_file/list_files) aren't named literally in the
			// prompt body — the model derives them from its tool catalog.
			expect(blob).toContain("write_to_file")
			expect(blob).toContain("search_files")
			expect(blob).not.toContain("the Write tool")
			expect(blob).not.toContain("GREP_TOOL_NAME")
		})

		it("includes the four type names", () => {
			const blob = buildMemoryLines("auto memory", "/mem/dir/", "/proj").join("\n")
			expect(blob).toContain("user")
			expect(blob).toContain("feedback")
			expect(blob).toContain("project")
			expect(blob).toContain("reference")
		})
	})

	describe("buildSearchingPastContextSection", () => {
		it("emits the search_files tool form (not embedded shell)", () => {
			const lines = buildSearchingPastContextSection("/mem/dir/", "/proj")
			const blob = lines.join("\n")
			expect(blob).toContain("search_files")
			expect(blob).toContain("/mem/dir/")
			// Should not contain a raw `grep -rn` shell invocation (Roo always has search_files).
			expect(blob).not.toContain("grep -rn")
		})
	})

	describe("loadMemoryIndex / loadMemoryPrompt", () => {
		let tmpBase: string
		const cwd = "/fake/cwd"

		beforeEach(async () => {
			tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "roo-mem-"))
			initMemoryPaths(tmpBase, () => ({}))
		})

		afterEach(async () => {
			resetMemoryPaths()
			await fs.rm(tmpBase, { recursive: true, force: true })
		})

		it("loadMemoryIndex returns '' when the entrypoint doesn't exist yet", async () => {
			expect(await loadMemoryIndex(cwd)).toBe("")
		})

		it("loadMemoryIndex returns the truncated content with a header when present", async () => {
			const memDir = path.join(tmpBase, "memory", "projects", "_fake_cwd", "memory")
			await fs.mkdir(memDir, { recursive: true })
			await fs.writeFile(path.join(memDir, "MEMORY.md"), "- [Title](file.md) — hook\n")
			const result = await loadMemoryIndex(cwd)
			expect(result).toContain("user's auto-memory")
			expect(result).toContain("- [Title](file.md) — hook")
		})

		it("loadMemoryIndex returns '' when memory is disabled", async () => {
			resetMemoryPaths()
			initMemoryPaths(tmpBase, () => ({ autoMemoryEnabled: false }))
			expect(await loadMemoryIndex(cwd)).toBe("")
		})

		it("loadMemoryPrompt returns '' when memory is disabled", async () => {
			resetMemoryPaths()
			initMemoryPaths(tmpBase, () => ({ autoMemoryEnabled: false }))
			expect(await loadMemoryPrompt(cwd)).toBe("")
		})

		it("loadMemoryPrompt returns the behavioral prompt when enabled (and ensures dir exists)", async () => {
			resetMemoryPaths()
			initMemoryPaths(tmpBase, () => ({}))
			const prompt = await loadMemoryPrompt(cwd)
			expect(prompt).toContain("auto memory")
			expect(prompt).toContain("write_to_file")
			// The dir should now exist.
			const memDir = path.join(tmpBase, "memory", "projects", "_fake_cwd", "memory")
			await fs.access(memDir)
		})
	})
})
