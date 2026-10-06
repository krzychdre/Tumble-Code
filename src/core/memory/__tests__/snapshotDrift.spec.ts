import { execFileSync, spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

import { runCommand, type CommandRunner } from "../claimEvidence"
import { type MemoryHeader } from "../memoryScan"
import {
	DRIFT_STATE_FILE,
	checkSnapshotDrift,
	extractCodeNames,
	extractRepoPaths,
	extractVersionMentions,
	renderFacts,
	specMatches,
	splitCheckLine,
	withCheckLine,
} from "../snapshotDrift"

const hasGit = spawnSync("git", ["--version"]).status === 0
const NOW = Date.UTC(2026, 9, 1, 12)
const day = (d: string) => Date.parse(`${d}T12:00:00Z`)

describe("extractRepoPaths", () => {
	it("keeps repo-relative paths with an extension and drops absolute paths and URLs", () => {
		expect(
			extractRepoPaths(
				"see src/core/a.ts, ./docs/b.md and /opt/x/compose.yml, ~/.roo/cli/c.json, https://x.io/a/b.js, ../up/d.ts",
			),
		).toEqual(["src/core/a.ts", "docs/b.md"])
	})
})

describe("extractCodeNames", () => {
	it("reads code-shaped names in code spans and bare, never prose", () => {
		const text =
			"`RooHandler` and `TaskSlot.seedForTests()` plus remoteControlEnabled, MAX_DREAM_QUERIES and `_compute_metrics`; " +
			"`ignore`, `pnpm knip`, Hello, words like nothing, short `aB`, bare abCd"
		expect(extractCodeNames(text).sort()).toEqual(
			["MAX_DREAM_QUERIES", "RooHandler", "_compute_metrics", "remoteControlEnabled", "seedForTests"].sort(),
		)
	})
})

describe("versions", () => {
	it("finds versions stated next to a known dependency name", () => {
		const deps = new Set(["react", "styled-components", "vitest"])
		expect(
			extractVersionMentions("React 19.3 upgrade, styled-components@6.4.4, vitest v5, Node 22.23.3", deps),
		).toEqual([
			{ name: "react", version: "19.3" },
			{ name: "styled-components", version: "6.4.4" },
			{ name: "vitest", version: "5" },
		])
	})

	it("matches a stated version against a package.json range by its leading parts", () => {
		expect(specMatches("^19.3.0", "19.3")).toBe(true)
		expect(specMatches("^19.3.0", "19")).toBe(true)
		expect(specMatches("^19.4.0", "19.3")).toBe(false)
		expect(specMatches("workspace:^1.0.0", "1")).toBe(false)
		expect(specMatches("*", "1")).toBe(false)
	})
})

describe("the check line", () => {
	it("is added on top, replaced and removed without touching the rest", () => {
		const body = "\nThe note.\n"
		const once = withCheckLine(body, ["`a` is no longer in the code"], "main", "2026-10-01", "2026-09-05")
		expect(once).toBe(
			"\n> Checked against main on 2026-10-01 (note from 2026-09-05): `a` is no longer in the code.\n\nThe note.\n",
		)
		expect(splitCheckLine(once)).toEqual({ facts: "`a` is no longer in the code.", rest: body })
		const twice = withCheckLine(once, ["`b` is no longer in the code"], "main", "2026-10-02", "2026-09-05")
		expect(splitCheckLine(twice).rest).toBe(body)
		expect(withCheckLine(twice, [], "main", "2026-10-02", "2026-09-05")).toBe(body)
	})

	it("shows at most five facts", () => {
		expect(renderFacts(["1", "2", "3", "4", "5", "6", "7"])).toBe("1; 2; 3; 4; 5; and 2 more.")
	})
})

// A missing file reads as an empty config on every platform. os.devNull does not:
// git for Windows fails on \\.\nul with "Invalid argument".
const NO_GIT_CONFIG = path.join(os.tmpdir(), "tumble-test-no-git-config", "config")

/** Runs git in a test repository, isolated from the user's config, with the commit date given. */
function git(cwd: string, date: string | undefined, ...args: string[]): string {
	const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: NO_GIT_CONFIG, GIT_CONFIG_NOSYSTEM: "1" }
	if (date) {
		env.GIT_AUTHOR_DATE = `${date}T12:00:00Z`
		env.GIT_COMMITTER_DATE = `${date}T12:00:00Z`
	}
	return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim()
}

function write(dir: string, file: string, content: string) {
	fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
	fs.writeFileSync(path.join(dir, file), content)
}

describe.skipIf(!hasGit)("checkSnapshotDrift", () => {
	let root: string
	let repo: string
	let memDir: string

	const note = (body: string, description = "A note") =>
		`---\nname: n\ndescription: ${description}\nmetadata:\n  type: project\n---\n\n${body}\n`

	async function writeNote(name: string, content: string, mtime: string): Promise<MemoryHeader> {
		const filePath = path.join(memDir, name)
		fs.writeFileSync(filePath, content)
		const t = day(mtime) / 1000
		fs.utimesSync(filePath, t, t)
		return { filename: name, filePath, mtimeMs: day(mtime), description: null, type: "project" }
	}

	function counting(): { run: CommandRunner; calls: string[][] } {
		const calls: string[][] = []
		return {
			calls,
			run: (file, args, options) => {
				calls.push(args)
				return runCommand(file, args, options)
			},
		}
	}

	const check = (memories: MemoryHeader[], run?: CommandRunner, cwd = repo) =>
		checkSnapshotDrift({ memoryDir: memDir, memories, cwd, signal: new AbortController().signal, now: NOW, run })

	beforeAll(() => {
		root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "roo-drift-")))
		repo = path.join(root, "repo")
		fs.mkdirSync(repo)
		git(repo, undefined, "init", "-q", "-b", "main")
		const filler = Array.from({ length: 20 }, (_, i) => `export const line${i} = ${i}\n`).join("")
		write(repo, "src/a.ts", `export function oldName() {}\nexport const keepName = 1\n${filler}`)
		write(repo, "package.json", JSON.stringify({ dependencies: { "left-pad": "^1.2.0" } }))
		git(repo, undefined, "add", "-A")
		git(repo, "2026-09-01", "commit", "-q", "-m", "start")
		git(repo, undefined, "mv", "src/a.ts", "src/b.ts")
		write(repo, "src/b.ts", `export const keepName = 1\n${filler}`)
		write(repo, "package.json", JSON.stringify({ dependencies: { "left-pad": "^2.0.0" } }))
		git(repo, undefined, "add", "-A")
		git(repo, "2026-09-10", "commit", "-q", "-m", "refactor: rename, drop oldName, bump left-pad (#12)")
	})

	afterAll(() => {
		if (root) fs.rmSync(root, { recursive: true, force: true })
	})

	beforeEach(() => {
		memDir = fs.mkdtempSync(path.join(root, "mem-"))
	})

	it("notes what changed since the memory's day, and nothing that was never in the repository", async () => {
		const memory = await writeNote(
			"project_x.md",
			note(
				"`src/a.ts` holds `oldName` and `keepName`; we pin left-pad 1.2. " +
					"Unrelated: `notInRepo`, other/repo.c, flexGrowLike.",
			),
			"2026-09-05",
		)
		expect(await check([memory])).toEqual([memory.filePath])
		const content = fs.readFileSync(memory.filePath, "utf-8")
		expect(content).toBe(
			note(
				"> Checked against main on 2026-10-01 (note from 2026-09-05): `src/a.ts` moved to `src/b.ts` (2026-09-10, #12); " +
					"`oldName` is no longer in the code (removed 2026-09-10, #12); package.json now has left-pad ^2.0.0 (the note says 1.2).\n\n" +
					"`src/a.ts` holds `oldName` and `keepName`; we pin left-pad 1.2. " +
					"Unrelated: `notInRepo`, other/repo.c, flexGrowLike.",
			),
		)
		// The memory keeps its day, a copy of the original is archived.
		expect(fs.statSync(memory.filePath).mtimeMs).toBe(day("2026-09-05"))
		expect(fs.readdirSync(path.join(memDir, ".archive"))).toHaveLength(1)
	})

	it("reuses the remembered then-side and writes nothing when the findings did not change", async () => {
		const memory = await writeNote("project_x.md", note("Calls `oldName`."), "2026-09-05")
		await check([memory])
		const first = fs.readFileSync(memory.filePath, "utf-8")
		const { run, calls } = counting()
		expect(await check([memory], run)).toEqual([])
		expect(fs.readFileSync(memory.filePath, "utf-8")).toBe(first)
		// One grep for the present only; the past and the removing commit came from the state file.
		expect(calls.filter((a) => a.includes("grep"))).toHaveLength(1)
		expect(calls.filter((a) => a.some((x) => x.startsWith("-S")))).toHaveLength(0)
		expect(JSON.parse(fs.readFileSync(path.join(memDir, DRIFT_STATE_FILE), "utf-8")).version).toBe(1)
	})

	it("drops the line once the memory is newer than the change", async () => {
		const memory = await writeNote("project_x.md", note("Calls `oldName`."), "2026-09-05")
		await check([memory])
		expect(splitCheckLine(fs.readFileSync(memory.filePath, "utf-8").split("---\n").pop()!).facts).toBeDefined()
		// Someone edits the memory after the change: its snapshot day moves past it.
		const updated = { ...memory, mtimeMs: day("2026-09-15") }
		fs.utimesSync(memory.filePath, day("2026-09-15") / 1000, day("2026-09-15") / 1000)
		expect(await check([updated])).toEqual([memory.filePath])
		expect(fs.readFileSync(memory.filePath, "utf-8")).toBe(note("Calls `oldName`."))
	})

	it("reads the description too and skips memories older than the repository", async () => {
		const described = await writeNote("project_d.md", note("Body.", "Uses `oldName`"), "2026-09-05")
		const ancient = await writeNote("project_old.md", note("Calls `oldName`."), "2026-08-01")
		expect(await check([described, ancient])).toEqual([described.filePath])
	})

	it("does nothing outside a git repository", async () => {
		const memory = await writeNote("project_x.md", note("Calls `oldName`."), "2026-09-05")
		expect(await check([memory], undefined, path.join(root, "nowhere"))).toEqual([])
		expect(fs.readFileSync(memory.filePath, "utf-8")).toBe(note("Calls `oldName`."))
	})

	it("throws 'aborted' when the signal has fired", async () => {
		const memory = await writeNote("project_x.md", note("Calls `oldName`."), "2026-09-05")
		const controller = new AbortController()
		controller.abort()
		await expect(
			checkSnapshotDrift({
				memoryDir: memDir,
				memories: [memory],
				cwd: repo,
				signal: controller.signal,
				now: NOW,
			}),
		).rejects.toThrow("aborted")
	})
})
