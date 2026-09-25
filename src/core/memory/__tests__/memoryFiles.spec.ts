import fs from "fs/promises"
import os from "os"
import path from "path"

import {
	ARCHIVE_DIR_NAME,
	archiveMemory,
	memoryFileName,
	saveMemoryDraft,
	slugifyMemoryName,
	syncMemoryIndex,
} from "../memoryFiles"
import { scanMemoryFiles } from "../memoryScan"
import { consolidateMemories, findMergeCandidates, parseDreamVerdict } from "../autoDream"

describe("memoryFiles", () => {
	let memDir: string

	beforeEach(async () => {
		memDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-memfiles-"))
	})

	afterEach(async () => {
		await fs.rm(memDir, { recursive: true, force: true })
	})

	async function write(name: string, description: string, body: string, type = "feedback") {
		await fs.writeFile(
			path.join(memDir, name),
			`---\nname: ${name}\ndescription: ${description}\ntype: ${type}\n---\n\n${body}\n`,
		)
	}

	it("slugifies model names into safe file names", () => {
		expect(slugifyMemoryName("Release Freeze!")).toBe("release_freeze")
		expect(slugifyMemoryName("../../etc/passwd")).toBe("etc_passwd")
		expect(slugifyMemoryName("***")).toBe("")
		expect(memoryFileName("user", "role")).toBe("user_role.md")
		expect(memoryFileName("user", "user_role")).toBe("user_role.md")
	})

	it("never writes outside the memory dir, whatever the model names the memory", async () => {
		const written = await saveMemoryDraft(
			memDir,
			{ type: "project", name: "../../outside", description: "d", body: "b" },
			[],
			"2026-09-25",
		)
		expect(written).toBe(path.join(memDir, "project_outside.md"))
	})

	it("syncMemoryIndex drops dead links, adds unindexed files and keeps hand-written lines", async () => {
		await write("feedback_a.md", "Rule A", "a")
		await write("feedback_b.md", "Rule B", "b")
		await fs.writeFile(
			path.join(memDir, "MEMORY.md"),
			"- [A](feedback_a.md) - my own hook\n- [Gone](feedback_gone.md) - removed\n",
		)
		const changes = await syncMemoryIndex(memDir, await scanMemoryFiles(memDir))
		expect(changes).toBe(2)
		expect(await fs.readFile(path.join(memDir, "MEMORY.md"), "utf-8")).toBe(
			"- [A](feedback_a.md) - my own hook\n- [feedback_b](feedback_b.md) - Rule B\n",
		)
		expect(await syncMemoryIndex(memDir, await scanMemoryFiles(memDir))).toBe(0)
	})

	it("archived memories disappear from the scan but stay on disk", async () => {
		await write("feedback_a.md", "Rule A", "a")
		const [header] = await scanMemoryFiles(memDir)
		await archiveMemory(memDir, header)
		expect(await scanMemoryFiles(memDir)).toEqual([])
		expect(await fs.readdir(path.join(memDir, ARCHIVE_DIR_NAME))).toHaveLength(1)
	})

	describe("dream consolidation", () => {
		const signal = new AbortController().signal

		it("pairs only same-type memories with overlapping topics", async () => {
			await write("feedback_pnpm_only.md", "Use pnpm, never npm, in this repo", "x")
			await write("feedback_pnpm_not_npm.md", "Use pnpm not npm in this repo", "y")
			await write("project_pnpm_repo.md", "pnpm repo migration", "z", "project")
			await write("feedback_tests_real_db.md", "Integration tests hit a real database", "w")
			const pairs = findMergeCandidates(await scanMemoryFiles(memDir))
			expect(pairs.map(([a, b]) => [a.filename, b.filename].sort())).toEqual([
				["feedback_pnpm_not_npm.md", "feedback_pnpm_only.md"],
			])
		})

		it("makes no model call when nothing looks duplicated", async () => {
			await write("feedback_a.md", "Integration tests hit a real database", "x")
			await write("user_b.md", "Backend engineer writing Go", "y", "user")
			const query = vi.fn(async () => "KEEP")
			expect(await consolidateMemories(memDir, query, signal)).toEqual([])
			expect(query).not.toHaveBeenCalled()
		})

		it("MERGE rewrites the older file and archives the newer one", async () => {
			await write("feedback_pnpm_only.md", "Use pnpm, never npm, in this repo", "Use pnpm.")
			await write("feedback_pnpm_not_npm.md", "Use pnpm not npm in this repo", "npm breaks the lockfile.")
			const older = path.join(memDir, "feedback_pnpm_only.md")
			await fs.utimes(older, 1_000, 1_000)
			const query = vi.fn(
				async () => "MERGE\nUse pnpm, never npm\nUse pnpm.\nWhy: npm breaks the lockfile.",
			)
			const changed = await consolidateMemories(memDir, query, signal)
			expect(changed).toHaveLength(2)
			const merged = await fs.readFile(older, "utf-8")
			expect(merged).toContain("description: Use pnpm, never npm\n")
			expect(merged).toContain("Why: npm breaks the lockfile.")
			expect((await scanMemoryFiles(memDir)).map((m) => m.filename)).toEqual(["feedback_pnpm_only.md"])
			const index = await fs.readFile(path.join(memDir, "MEMORY.md"), "utf-8")
			expect(index).toContain("(feedback_pnpm_only.md)")
			expect(index).not.toContain("feedback_pnpm_not_npm.md")
		})

		it("refuses a merge that loses most of the text", async () => {
			const long = "A fact worth keeping. ".repeat(20)
			await write("feedback_pnpm_only.md", "Use pnpm, never npm, in this repo", long)
			await write("feedback_pnpm_not_npm.md", "Use pnpm not npm in this repo", "short")
			const query = vi.fn(async () => "MERGE\nUse pnpm\nUse pnpm.")
			expect(await consolidateMemories(memDir, query, signal)).toEqual([])
			expect(await scanMemoryFiles(memDir)).toHaveLength(2)
		})

		it("DROP archives the named file; anything unrecognised keeps both", async () => {
			await write("feedback_pnpm_only.md", "Use pnpm, never npm, in this repo", "x")
			await write("feedback_pnpm_not_npm.md", "Use pnpm not npm in this repo", "y")
			const unsure = vi.fn(async () => "I think these are similar.")
			expect(await consolidateMemories(memDir, unsure, signal)).toEqual([])
			expect(await scanMemoryFiles(memDir)).toHaveLength(2)

			const drop = vi.fn(async () => "**DROP 2**")
			expect(await consolidateMemories(memDir, drop, signal)).toHaveLength(1)
			expect(await scanMemoryFiles(memDir)).toHaveLength(1)
		})

		it("parseDreamVerdict tolerates a think block and a fence", () => {
			expect(parseDreamVerdict("<think>same topic</think>\n```\nDROP 1\n```")).toEqual({ kind: "drop", which: 1 })
			expect(parseDreamVerdict("MERGE\n\nsummary: s\nbody")).toEqual({
				kind: "merge",
				description: "s",
				body: "body",
			})
			expect(parseDreamVerdict("MERGE\nonly a summary")).toEqual({ kind: "keep" })
		})
	})
})
