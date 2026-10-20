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
	buildCompactMemoryInstruction,
	truncateCompactMemoryIndex,
	compactMemoryIndex,
	loadCompactMemoryIndex,
	loadCompactMemoryPrompt,
	COMPACT_MAX_INDEX_CHARS,
	COMPACT_INDEX_HOOK_CHARS,
} from "../memoryPrompt"
import { initMemoryPaths, resetMemoryPaths } from "../paths"
import { scanMemoryFiles } from "../memoryScan"

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

		it("tells the model to write memory files in English, right after the two save steps", () => {
			const lines = buildMemoryLines("auto memory", "/mem/dir/", "/proj")
			const rule = lines.findIndex((l) => l.startsWith("Write memory files entirely in English"))
			const step2 = lines.findIndex((l) => l.startsWith("**Step 2**"))
			expect(step2).toBeGreaterThan(-1)
			expect(rule).toBeGreaterThan(step2)
			expect(rule - step2).toBeLessThanOrEqual(2)
			expect(lines[rule]).toContain("whatever language the conversation uses")
			expect(lines[rule]).toContain("render the meaning and the tone of their words")
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

describe("memoryPrompt, compact profile variants", () => {
	describe("buildCompactMemoryInstruction", () => {
		// A realistic per-workspace memory path: VS Code global storage plus the
		// sanitized workspace path, about 120 characters.
		const longDir = `/home/someone/.config/Code/User/globalStorage/tumble.tumble-code/memory/projects/_home_someone_projects_app/memory/`

		it("stays within 600 characters with a 120-character memory path", () => {
			expect(longDir.length).toBeGreaterThanOrEqual(115)
			expect(buildCompactMemoryInstruction(longDir).length).toBeLessThanOrEqual(600)
		})

		it("says what the directory is, when to read a note and when to save one", () => {
			const text = buildCompactMemoryInstruction("/mem/dir/")
			expect(text).toContain("/mem/dir/")
			expect(text).toContain("MEMORY.md")
			expect(text).toContain("read_file")
			expect(text).toContain("only when the user asks you to remember something or states a lasting preference")
			expect(text).toContain("in English")
		})

		it("contains no en or em dash", () => {
			expect(buildCompactMemoryInstruction("/mem/dir/")).not.toMatch(/[\u2013\u2014]/)
		})

		it("shows a note start that recall reads a description from", async () => {
			// The example frontmatter, as the model would copy it into a new note.
			const lines = buildCompactMemoryInstruction("/mem/dir/").split("\n")
			const open = lines.indexOf("---")
			const close = lines.indexOf("---", open + 1)
			expect(open).toBeGreaterThan(-1)
			expect(close).toBeGreaterThan(open)
			const note = `${lines.slice(open, close + 1).join("\n")}\nRun the tests with pnpm test.\n`

			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "compact-memory-note-"))
			try {
				await fs.writeFile(path.join(dir, "tests.md"), note, "utf-8")
				const [header] = await scanMemoryFiles(dir)
				expect(header.filename).toBe("tests.md")
				expect(header.description).toBe("run the tests with pnpm test")
			} finally {
				await fs.rm(dir, { recursive: true, force: true })
			}
		})
	})

	describe("compactMemoryIndex", () => {
		it("turns link lines into '- file: hook' and drops headings and blank lines", () => {
			const raw =
				"# Memory Index\n\n- [Coffee log](project_coffee_log.md) - Coffee goes to zdrowie/dziennik-kawy.md\n"
			expect(compactMemoryIndex(raw)).toBe("- project_coffee_log.md: Coffee goes to zdrowie/dziennik-kawy.md")
		})

		it.each(["\u2014", "\u2013", ":", "-"])("accepts %s as the separator", (sep) => {
			expect(compactMemoryIndex(`- [Scope](scope.md) ${sep} Private matters`)).toBe("- scope.md: Private matters")
		})

		it("keeps hyphens inside the hook", () => {
			expect(compactMemoryIndex("- [Server](srv.md) - CPU-bound transfer - not the disk")).toBe(
				"- srv.md: CPU-bound transfer - not the disk",
			)
		})

		it("uses the title when the line has no hook", () => {
			expect(compactMemoryIndex("- [Run the tests](tests.md)")).toBe("- tests.md: Run the tests")
		})

		it("cuts a long hook at a word boundary and marks the cut", () => {
			const hook = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ")
			const line = compactMemoryIndex(`- [N](n.md) - ${hook}`)
			const text = line.slice("- n.md: ".length)
			expect(text.endsWith("...")).toBe(true)
			expect(text.length).toBeLessThanOrEqual(COMPACT_INDEX_HOOK_CHARS + 3)
			expect(hook.startsWith(text.slice(0, -3))).toBe(true)
			expect(hook[text.length - 3]).toBe(" ")
		})

		it("keeps a line in another format, cut to the hook length", () => {
			expect(compactMemoryIndex("Notes about the build live in build.md")).toBe(
				"Notes about the build live in build.md",
			)
			expect(compactMemoryIndex("q".repeat(300))).toBe(`${"q".repeat(COMPACT_INDEX_HOOK_CHARS)}...`)
		})

		it("never reads past a closing bracket into the file name", () => {
			expect(compactMemoryIndex("- [A] [B](b.md) - x")).toBe("- [A] [B](b.md) - x")
		})
	})

	describe("truncateCompactMemoryIndex", () => {
		it("keeps a short index unchanged (trimmed)", () => {
			expect(truncateCompactMemoryIndex("\n- [A](a.md) - one\n")).toBe("- [A](a.md) - one")
		})

		it("cuts a long index at a line boundary and adds a one-line note", () => {
			const lines = Array.from({ length: 120 }, (_, i) => `- [Note ${i}](note_${i}.md) - ${"x".repeat(60)}`)
			const raw = lines.join("\n")
			expect(raw.length).toBeGreaterThan(COMPACT_MAX_INDEX_CHARS)

			const result = truncateCompactMemoryIndex(raw)
			const [kept, note, ...rest] = result.split(/\n(?=\[MEMORY\.md is longer)/)

			expect(rest).toEqual([])
			expect(kept.length).toBeLessThanOrEqual(COMPACT_MAX_INDEX_CHARS)
			// Every kept line is a whole line of the original.
			for (const line of kept.split("\n")) {
				expect(lines).toContain(line)
			}
			expect(note).toMatch(/^\[MEMORY\.md is longer; only its first lines are shown\..*\]$/)
			expect(note).not.toContain("\n")
		})

		it("names the memory directory to search when it is given", () => {
			const result = truncateCompactMemoryIndex("z".repeat(COMPACT_MAX_INDEX_CHARS + 1), "/mem/dir/")
			expect(result).toContain('call search_files with path "/mem/dir/" and a keyword')
		})

		it("cuts inside a single line that is longer than the cap", () => {
			const result = truncateCompactMemoryIndex("y".repeat(COMPACT_MAX_INDEX_CHARS + 500))
			expect(result.startsWith("y".repeat(COMPACT_MAX_INDEX_CHARS))).toBe(true)
			expect(result).toContain("[MEMORY.md is longer")
		})
	})

	describe("loadCompactMemoryIndex / loadCompactMemoryPrompt", () => {
		let tmpBase: string
		const cwd = "/fake/cwd"
		const memDirFor = (base: string) => path.join(base, "memory", "projects", "_fake_cwd", "memory")
		const savedEnv = process.env.ROO_DISABLE_AUTO_MEMORY

		beforeEach(async () => {
			tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "roo-mem-compact-"))
			initMemoryPaths(tmpBase, () => ({}))
		})

		afterEach(async () => {
			resetMemoryPaths()
			if (savedEnv === undefined) delete process.env.ROO_DISABLE_AUTO_MEMORY
			else process.env.ROO_DISABLE_AUTO_MEMORY = savedEnv
			await fs.rm(tmpBase, { recursive: true, force: true })
		})

		it("returns the instruction naming the memory dir and creates the dir", async () => {
			const prompt = await loadCompactMemoryPrompt(cwd)
			expect(prompt).toContain(memDirFor(tmpBase))
			await fs.access(memDirFor(tmpBase))
		})

		it("returns '' for the index when MEMORY.md does not exist yet", async () => {
			expect(await loadCompactMemoryIndex(cwd)).toBe("")
		})

		it("returns the compact, capped index with its heading when MEMORY.md exists", async () => {
			await fs.mkdir(memDirFor(tmpBase), { recursive: true })
			const body = Array.from({ length: 80 }, (_, i) => `- [N${i}](n${i}.md) - ${"z".repeat(80)}`).join("\n")
			await fs.writeFile(path.join(memDirFor(tmpBase), "MEMORY.md"), body)

			const index = await loadCompactMemoryIndex(cwd)
			expect(index.startsWith(`MEMORY.md:\n- n0.md: ${"z".repeat(80)}`)).toBe(true)
			expect(index).toContain(
				`[MEMORY.md is longer; only its first lines are shown. To find another note, call search_files with path "${memDirFor(tmpBase)}`,
			)
			expect(index).not.toContain("n79.md")
		})

		it("only reads MEMORY.md: the shared file stays byte-identical", async () => {
			await fs.mkdir(memDirFor(tmpBase), { recursive: true })
			const file = path.join(memDirFor(tmpBase), "MEMORY.md")
			const body = "# Memory Index\n\n- [Coffee](coffee.md) \u2014 Coffee goes to zdrowie/dziennik-kawy.md\n"
			await fs.writeFile(file, body)

			expect(await loadCompactMemoryIndex(cwd)).toBe(
				"MEMORY.md:\n- coffee.md: Coffee goes to zdrowie/dziennik-kawy.md",
			)
			expect(await fs.readFile(file, "utf-8")).toBe(body)
		})

		it("returns '' when MEMORY.md holds only a heading", async () => {
			await fs.mkdir(memDirFor(tmpBase), { recursive: true })
			await fs.writeFile(path.join(memDirFor(tmpBase), "MEMORY.md"), "# Memory Index\n")
			expect(await loadCompactMemoryIndex(cwd)).toBe("")
		})

		it("leaves the long index loader unchanged by the compact cap", async () => {
			await fs.mkdir(memDirFor(tmpBase), { recursive: true })
			const body = Array.from({ length: 50 }, (_, i) => `- [N${i}](n${i}.md) - ${"z".repeat(80)}`).join("\n")
			await fs.writeFile(path.join(memDirFor(tmpBase), "MEMORY.md"), body)

			expect(await loadMemoryIndex(cwd)).toContain("[N49]")
		})

		it.each([
			["autoMemoryEnabled: false", () => initMemoryPaths(tmpBase, () => ({ autoMemoryEnabled: false }))],
			[
				"ROO_DISABLE_AUTO_MEMORY=1",
				() => {
					process.env.ROO_DISABLE_AUTO_MEMORY = "1"
					initMemoryPaths(tmpBase, () => ({}))
				},
			],
			["memory paths not initialized", () => {}],
		])("returns '' for both when memory is off (%s)", async (_label, setUp) => {
			await fs.mkdir(memDirFor(tmpBase), { recursive: true })
			await fs.writeFile(path.join(memDirFor(tmpBase), "MEMORY.md"), "- [A](a.md) - one")
			resetMemoryPaths()
			setUp()

			expect(await loadCompactMemoryPrompt(cwd)).toBe("")
			expect(await loadCompactMemoryIndex(cwd)).toBe("")
		})
	})
})
