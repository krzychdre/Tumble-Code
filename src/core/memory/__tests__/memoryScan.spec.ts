import fs from "fs/promises"
import os from "os"
import path from "path"

import { scanMemoryFiles, formatMemoryManifest } from "../memoryScan"

describe("scanMemoryFiles", () => {
	let memDir: string

	beforeEach(async () => {
		memDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-scan-"))
	})

	afterEach(async () => {
		await fs.rm(memDir, { recursive: true, force: true })
	})

	it("returns [] for a non-existent directory", async () => {
		expect(await scanMemoryFiles(path.join(memDir, "nope"))).toEqual([])
	})

	it("returns [] for an empty directory", async () => {
		expect(await scanMemoryFiles(memDir)).toEqual([])
	})

	it("skips MEMORY.md and parses frontmatter for topic files", async () => {
		await fs.writeFile(
			path.join(memDir, "user.md"),
			"---\nname: U\ndescription: a user memory\ntype: user\n---\nbody",
		)
		await fs.writeFile(path.join(memDir, "MEMORY.md"), "- [U](user.md) — hook\n")
		const result = await scanMemoryFiles(memDir)
		expect(result.length).toBe(1)
		expect(result[0].filename).toBe("user.md")
		expect(result[0].description).toBe("a user memory")
		expect(result[0].type).toBe("user")
	})

	it("sorts by mtime descending (most recent first)", async () => {
		const older = path.join(memDir, "old.md")
		const newer = path.join(memDir, "new.md")
		await fs.writeFile(older, "---\ntype: user\n---\n")
		// Ensure newer has a strictly greater mtime.
		const now = Math.floor(Date.now() / 1000)
		await fs.writeFile(newer, "---\ntype: feedback\n---\n")
		await fs.utimes(newer, now + 100, now + 100)
		await fs.utimes(older, now - 100, now - 100)
		const result = await scanMemoryFiles(memDir)
		expect(result[0].filename).toBe("new.md")
		expect(result[1].filename).toBe("old.md")
	})

	it("swallows per-file errors (a corrupt file doesn't break the rest)", async () => {
		// A directory named *.md will fail frontmatter parsing but shouldn't
		// throw — it's caught by Promise.allSettled's fulfilled filter via the
		// inner try/catch. Use a non-readable file path trick: a subdirectory.
		await fs.mkdir(path.join(memDir, "weird.md"))
		await fs.writeFile(path.join(memDir, "good.md"), "---\ntype: user\n---\nbody")
		const result = await scanMemoryFiles(memDir)
		// weird.md is a directory → read fails → excluded; good.md survives.
		expect(result.some((m) => m.filename === "good.md")).toBe(true)
		expect(result.some((m) => m.filename === "weird.md")).toBe(false)
	})
})

describe("formatMemoryManifest", () => {
	it("includes the type tag and description when present", () => {
		const manifest = formatMemoryManifest([
			{ filename: "a.md", filePath: "/m/a.md", mtimeMs: 1_700_000_000_000, description: "desc", type: "user" },
		])
		expect(manifest).toContain("[user] a.md")
		expect(manifest).toContain("desc")
	})

	it("omits the tag and description when absent", () => {
		const manifest = formatMemoryManifest([
			{ filename: "b.md", filePath: "/m/b.md", mtimeMs: 1_700_000_000_000, description: null, type: undefined },
		])
		expect(manifest).toContain("b.md")
		expect(manifest).not.toContain("[")
	})
})
