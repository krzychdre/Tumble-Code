import fsSync from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"

import {
	CHECK_STATE_FILE,
	CLAIM_CHECK_SYSTEM_PROMPT,
	MAX_CLAIM_QUERIES,
	findNewerStatements,
	parseClaimVerdict,
	verifyTimeBoundClaims,
} from "../claimCheck"
import { scanMemoryFiles } from "../memoryScan"
import { type ClaimEvidence, type ClaimRef } from "../timeBoundClaims"

const NOW = Date.parse("2026-10-01T12:00:00Z")
const DAY = 86_400_000

let dir: string

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(fsSync.realpathSync.native(os.tmpdir()), "roo-claims-"))
})

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true })
})

/** Write a memory file whose mtime is `daysAgo` days before {@link NOW}. */
async function writeMemory(filename: string, content: string, daysAgo: number): Promise<string> {
	const filePath = path.join(dir, filename)
	await fs.writeFile(filePath, content)
	const t = (NOW - daysAgo * DAY) / 1000
	await fs.utimes(filePath, t, t)
	return filePath
}

function memory(description: string, body: string, extraHead = ""): string {
	return `---\nname: x\ndescription: ${description}\n${extraHead}type: project\n---\n\n${body}\n`
}

function stubQuery(answer: string | ((user: string) => string)) {
	const calls: Array<{ system: string; user: string }> = []
	const query = async (system: string, user: string) => {
		calls.push({ system, user })
		return typeof answer === "string" ? answer : answer(user)
	}
	return { calls, query }
}

function stubEvidence(
	landed: (ref: ClaimRef) => boolean | undefined,
	text = (ref: ClaimRef) => `${JSON.stringify(ref)} is on main.`,
) {
	const calls: ClaimRef[][] = []
	const evidence = async (refs: ReadonlyArray<ClaimRef>): Promise<ClaimEvidence[]> => {
		calls.push([...refs])
		return refs.map((ref) => ({ ref, landed: landed(ref), text: text(ref) }))
	}
	return { calls, evidence }
}

async function run(
	query: (system: string, user: string, signal: AbortSignal) => Promise<string>,
	opts: { evidence?: ReturnType<typeof stubEvidence>["evidence"]; signal?: AbortSignal; now?: number } = {},
) {
	return verifyTimeBoundClaims({
		memoryDir: dir,
		memories: await scanMemoryFiles(dir),
		query,
		evidence: opts.evidence,
		signal: opts.signal ?? new AbortController().signal,
		now: opts.now ?? NOW,
	})
}

async function archived(): Promise<string[]> {
	try {
		return (await fs.readdir(path.join(dir, ".archive"))).map((f) => f.replace(/^\d+_/, "")).sort()
	} catch {
		return []
	}
}

async function readState() {
	return JSON.parse(await fs.readFile(path.join(dir, CHECK_STATE_FILE), "utf-8"))
}

describe("parseClaimVerdict", () => {
	it.each([
		["DONE", "done"],
		["**done**.", "done"],
		["<think>x</think>\nDONE", "done"],
		["Answer: DONE", "done"],
		["```\nDONE\n```", "done"],
		["STILL", "still"],
		["", "still"],
		["I think it is done", "still"],
		["<think>DONE", "still"],
	])("%j => %s", (answer, verdict) => {
		expect(parseClaimVerdict(answer)).toBe(verdict)
	})
})

describe("findNewerStatements", () => {
	const source = { filename: "project_old.md", mtimeMs: NOW - 3 * DAY }

	it("finds a newer completion clause on the claim's topic", () => {
		const others = [
			{
				filename: "project_audit.md",
				mtimeMs: NOW - DAY,
				content:
					"---\ndescription: VSIX rebuilt\n---\n\nVSIX+CLI+cloud api image all = main@059bac30c rebuilt.\n",
			},
		]
		expect(findNewerStatements("VSIX rebuild still owed.", source, others)).toEqual([
			{
				filename: "project_audit.md",
				date: "2026-09-30",
				text: "VSIX+CLI+cloud api image all = main@059bac30c rebuilt.",
			},
		])
	})

	it("does not treat a clause the check already resolved as a fact", () => {
		const others = [
			{
				filename: "project_newer.md",
				mtimeMs: NOW - DAY,
				content: "VSIX rebuild owed [resolved 2026-09-30: newer note project_audit.md says so].\n",
			},
		]
		expect(findNewerStatements("VSIX rebuild still owed.", source, others)).toEqual([])
	})

	it("needs a shared anchor and two shared topic words when the claim has them", () => {
		const others = [{ filename: "project_x.md", mtimeMs: NOW - DAY, content: "VSIX rebuilt.\n" }]
		expect(findNewerStatements("API image rebuild STILL OWED", source, others)).toEqual([])
		const matching = [{ filename: "project_x.md", mtimeMs: NOW - DAY, content: "The API image was rebuilt.\n" }]
		expect(findNewerStatements("API image rebuild STILL OWED", source, matching)).toHaveLength(1)
		// Plain words are no anchor: "git", "tree" or "api" matched unrelated notes on a real store.
		const plain = [{ filename: "project_x.md", mtimeMs: NOW - DAY, content: "The api image was rebuilt.\n" }]
		expect(findNewerStatements("api image rebuild STILL OWED", source, plain)).toEqual([])
	})

	it("needs the claim's own action reported as finished", () => {
		const others = [
			{ filename: "project_x.md", mtimeMs: NOW - DAY, content: "VSIX installed. VSIX review done.\n" },
		]
		expect(findNewerStatements("VSIX rebuild still owed.", source, others)).toEqual([])
		const negated = [{ filename: "project_x.md", mtimeMs: NOW - DAY, content: "VSIX was not rebuilt.\n" }]
		expect(findNewerStatements("VSIX rebuild still owed.", source, negated)).toEqual([])
		// A claim naming no action accepts any completion word, but needs two shared anchors.
		const one = [{ filename: "project_x.md", mtimeMs: NOW - DAY, content: "DEF-C36 is done.\n" }]
		expect(findNewerStatements("Still open: DEF-C36 `maxTokens` cap", source, one)).toEqual([])
		const two = [{ filename: "project_x.md", mtimeMs: NOW - DAY, content: "DEF-C36 `maxTokens` cap is done.\n" }]
		expect(findNewerStatements("Still open: DEF-C36 `maxTokens` cap", source, two)).toHaveLength(1)
		// Polish negation with an auxiliary verb is not a completion.
		const pl = [{ filename: "project_x.md", mtimeMs: NOW - DAY, content: "VSIX nie jest przebudowany.\n" }]
		expect(findNewerStatements("VSIX rebuild still owed.", source, pl)).toEqual([])
	})

	it("ignores older memories, time-bound clauses, frontmatter and fenced code", () => {
		const others = [
			{ filename: "project_older.md", mtimeMs: NOW - 5 * DAY, content: "VSIX rebuilt.\n" },
			{ filename: "project_same.md", mtimeMs: source.mtimeMs, content: "VSIX rebuilt.\n" },
			{
				filename: "project_newer.md",
				mtimeMs: NOW - DAY,
				content: "---\ndescription: VSIX rebuilt\n---\nVSIX not rebuilt yet.\n```\nVSIX rebuilt\n```\n",
			},
		]
		expect(findNewerStatements("VSIX rebuild still owed.", source, others)).toEqual([])
	})

	it("returns at most two, newest first, cut to 200 chars", () => {
		const long = `VSIX rebuilt ${"x".repeat(300)}`
		const others = [
			{ filename: "a.md", mtimeMs: NOW - 2 * DAY, content: "VSIX rebuilt on Monday.\n" },
			{ filename: "b.md", mtimeMs: NOW - DAY, content: `${long}\n` },
			{ filename: "c.md", mtimeMs: NOW - 1.5 * DAY, content: "VSIX rebuilt again.\n" },
		]
		const found = findNewerStatements("VSIX rebuild still owed.", source, others)
		expect(found.map((s) => s.filename)).toEqual(["b.md", "c.md"])
		expect(found[0].text).toHaveLength(200)
	})

	it("counts a ref as one topic word and reads Polish completion words", () => {
		const others = [{ filename: "p.md", mtimeMs: NOW - DAY, content: "fix/chart-axis zmergowane do main.\n" }]
		expect(findNewerStatements("fix/chart-axis jeszcze nie zmergowane", source, others)).toHaveLength(1)
	})
})

describe("verifyTimeBoundClaims", () => {
	it("asks nothing when no evidence could settle the clause", async () => {
		await writeMemory("project_tokens.md", memory("VSIX rebuild still owed.", "VSIX rebuild still owed."), 3)
		const { calls, query } = stubQuery("DONE")
		expect(await run(query)).toEqual([])
		expect(calls).toHaveLength(0)
		await expect(fs.access(path.join(dir, CHECK_STATE_FILE))).rejects.toThrow()
	})

	it("edits the description, body and index line on DONE when every ref landed, after backing them up", async () => {
		const original = memory(
			"Chart fix done; fix/cloud-daily-chart-axis STILL unmerged",
			"- fix/cloud-daily-chart-axis STILL unmerged; rebase first.\nOther line.",
		)
		const filePath = await writeMemory("project_chart.md", original, 3)
		const index =
			"- [Chart axis](project_chart.md) - Chart fix done; fix/cloud-daily-chart-axis STILL unmerged\n" +
			"- [Other](project_other.md) - fix/cloud-daily-chart-axis STILL unmerged\n"
		await fs.writeFile(path.join(dir, "MEMORY.md"), index)
		const mtimeBefore = (await fs.stat(filePath)).mtimeMs
		const { calls, query } = stubQuery("DONE")
		const ev = stubEvidence(
			() => true,
			() => "Branch fix/cloud-daily-chart-axis is on main as commit 8437ea7e6 (2026-09-30).",
		)

		expect(await run(query, { evidence: ev.evidence })).toEqual([filePath])

		expect(ev.calls).toEqual([[{ kind: "branch", name: "fix/cloud-daily-chart-axis" }]])
		expect(calls).toHaveLength(1)
		expect(calls[0].system).toBe(CLAIM_CHECK_SYSTEM_PROMPT)
		expect(calls[0].user).toBe(
			[
				"Note file: project_chart.md",
				'Sentence (the note was last changed 2026-09-28, 3 days ago): "fix/cloud-daily-chart-axis STILL unmerged"',
				"Facts found today (2026-10-01):",
				"- Branch fix/cloud-daily-chart-axis is on main as commit 8437ea7e6 (2026-09-30).",
			].join("\n"),
		)
		const note =
			"[resolved 2026-10-01: Branch fix/cloud-daily-chart-axis is on main as commit 8437ea7e6 (2026-09-30)]"
		expect(await fs.readFile(filePath, "utf-8")).toBe(
			memory("Chart fix done", `- fix/cloud-daily-chart-axis STILL unmerged ${note}; rebase first.\nOther line.`),
		)
		expect(await fs.readFile(path.join(dir, "MEMORY.md"), "utf-8")).toBe(
			"- [Chart axis](project_chart.md) - Chart fix done\n" +
				"- [Other](project_other.md) - fix/cloud-daily-chart-axis STILL unmerged\n",
		)
		expect(await archived()).toEqual(["MEMORY.md", "project_chart.md"])
		const backups = await fs.readdir(path.join(dir, ".archive"))
		const backup = (name: string) => path.join(dir, ".archive", backups.find((f) => f.endsWith(`_${name}`))!)
		expect(await fs.readFile(backup("project_chart.md"), "utf-8")).toBe(original)
		expect(await fs.readFile(backup("MEMORY.md"), "utf-8")).toBe(index)
		// The note keeps its age, so newer notes still count as newer next time.
		expect((await fs.stat(filePath)).mtimeMs).toBe(mtimeBefore)
		expect(Object.values((await readState()).checks)).toEqual([{ at: "2026-10-01", verdict: "done" }])
	})

	it("does not let a merged PR settle a rebuild, or a merge of a different change", async () => {
		await writeMemory(
			"project_ui.md",
			memory("UI", "VSIX rebuild owed for #570.\n- branch STILL unmerged and now CONFLICTS with #654."),
			3,
		)
		const { calls, query } = stubQuery("DONE")
		const ev = stubEvidence(
			() => true,
			() => "PR is on main.",
		)
		expect(await run(query, { evidence: ev.evidence })).toEqual([])
		expect(ev.calls).toEqual([])
		expect(calls).toHaveLength(0)
	})

	it("never asks when a ref is known not to have landed, even with a newer note", async () => {
		await writeMemory("project_old.md", memory("Tokens", "VSIX for #700 not merged yet."), 3)
		await writeMemory("project_new.md", memory("Later", "VSIX for #700 merged."), 1)
		const { calls, query } = stubQuery("DONE")
		const ev = stubEvidence(() => false)
		expect(await run(query, { evidence: ev.evidence })).toEqual([])
		expect(ev.calls).toHaveLength(1)
		expect(calls).toHaveLength(0)
	})

	it("settles a clause from a newer note and quotes the annotated description", async () => {
		const filePath = await writeMemory(
			"project_tokens.md",
			memory("VSIX rebuild still owed.", "Tokens shipped. VSIX rebuild still owed."),
			3,
		)
		await writeMemory(
			"project_audit.md",
			memory("Audit", "VSIX+CLI+cloud api image all = main@059bac30c rebuilt."),
			1,
		)
		const { calls, query } = stubQuery("DONE")

		expect(await run(query)).toEqual([filePath])

		expect(calls).toHaveLength(1)
		expect(calls[0].user).toContain(
			'- A newer note (project_audit.md, 2026-09-30) says: "VSIX+CLI+cloud api image all = main@059bac30c rebuilt."',
		)
		const note = "[resolved 2026-10-01: newer note project_audit.md says so]"
		expect(await fs.readFile(filePath, "utf-8")).toBe(
			`---\nname: x\ndescription: "VSIX rebuild still owed ${note}."\ntype: project\n---\n\n` +
				`Tokens shipped. VSIX rebuild still owed ${note}.\n`,
		)
	})

	it("does not ask when the newer note is about something else", async () => {
		await writeMemory("project_api.md", memory("Cloud", "api image rebuild STILL OWED"), 3)
		await writeMemory("project_vsix.md", memory("Vsix", "VSIX rebuilt."), 1)
		const { calls, query } = stubQuery("DONE")
		expect(await run(query)).toEqual([])
		expect(calls).toHaveLength(0)
	})

	it("records STILL, does not re-ask it for two weeks, and re-asks at once when the facts change", async () => {
		const filePath = await writeMemory("project_tokens.md", memory("Tokens", "VSIX rebuild still owed."), 5)
		await writeMemory("project_audit.md", memory("Audit", "VSIX rebuilt from main."), 3)
		// A corrupt state file reads as empty.
		await fs.writeFile(path.join(dir, CHECK_STATE_FILE), "{not json")
		const { calls, query } = stubQuery("STILL")

		expect(await run(query)).toEqual([])
		expect(calls).toHaveLength(1)
		expect(Object.values((await readState()).checks)).toEqual([{ at: "2026-10-01", verdict: "still" }])
		expect(await fs.readFile(filePath, "utf-8")).toBe(memory("Tokens", "VSIX rebuild still owed."))

		await run(query, { now: NOW + 13 * DAY })
		expect(calls).toHaveLength(1)

		await run(query, { now: NOW + 14 * DAY })
		expect(calls).toHaveLength(2)

		await writeMemory("project_later.md", memory("Later", "VSIX rebuilt again on the laptop."), 1)
		await run(query)
		expect(calls).toHaveLength(3)
		expect(calls[2].user).toContain("project_later.md")
	})

	it("prunes state entries older than 90 days on write", async () => {
		await writeMemory("project_tokens.md", memory("Tokens", "VSIX rebuild still owed."), 5)
		await writeMemory("project_audit.md", memory("Audit", "VSIX rebuilt from main."), 3)
		await fs.writeFile(
			path.join(dir, CHECK_STATE_FILE),
			JSON.stringify({
				version: 1,
				checks: { old: { at: "2026-06-01", verdict: "still" }, recent: { at: "2026-09-01", verdict: "done" } },
			}),
		)
		await run(stubQuery("STILL").query)
		const checks = (await readState()).checks
		expect(checks.old).toBeUndefined()
		expect(checks.recent).toEqual({ at: "2026-09-01", verdict: "done" })
		expect(Object.keys(checks)).toHaveLength(2)
	})

	it(`asks at most ${MAX_CLAIM_QUERIES} questions per run`, async () => {
		const body = [101, 102, 103, 104, 105, 106].map((n) => `- #${n} not merged yet.`).join("\n")
		await writeMemory("project_many.md", memory("Many fixes", body), 3)
		const { calls, query } = stubQuery("STILL")
		const ev = stubEvidence(() => true)
		await run(query, { evidence: ev.evidence })
		expect(calls).toHaveLength(MAX_CLAIM_QUERIES)
		expect(Object.keys((await readState()).checks)).toHaveLength(MAX_CLAIM_QUERIES)
	})

	it("keeps a quoted description quoted and a nested metadata block byte-identical", async () => {
		const head =
			"---\nname: tokens\n" +
			'description: "Faza 1: tokens merged #570; VSIX rebuild owed"\n' +
			"metadata:\n  type: project\n  originSessionId: 7f3c\n  tags: [a, b]\n" +
			"type: project\n---\n"
		const filePath = await writeMemory("project_tokens.md", `${head}\nBody without claims.\n`, 3)
		await writeMemory("project_audit.md", memory("Audit", "VSIX rebuilt from main."), 1)
		const { calls, query } = stubQuery("DONE")
		await run(query)
		expect(calls).toHaveLength(1)
		expect(await fs.readFile(filePath, "utf-8")).toBe(
			head.replace('"Faza 1: tokens merged #570; VSIX rebuild owed"', '"Faza 1: tokens merged #570"') +
				"\nBody without claims.\n",
		)
	})

	it("quotes a description that gains ': ' and edits an index line separated by an em dash", async () => {
		const filePath = await writeMemory(
			"project_tokens.md",
			memory("UI-1 tokens merged; VSIX rebuild owed", "Body."),
			3,
		)
		await writeMemory("project_audit.md", memory("Audit", "VSIX rebuilt from main."), 1)
		await fs.writeFile(
			path.join(dir, "MEMORY.md"),
			"# Index\n- [UI-1 tokens](project_tokens.md) \u2014 UI-1 tokens merged; VSIX rebuild owed\n",
		)
		await run(stubQuery("DONE").query)
		expect(await fs.readFile(path.join(dir, "MEMORY.md"), "utf-8")).toBe(
			"# Index\n- [UI-1 tokens](project_tokens.md) \u2014 UI-1 tokens merged\n",
		)
		expect(await fs.readFile(filePath, "utf-8")).toBe(memory("UI-1 tokens merged", "Body."))
	})

	it("annotates a clause that is the whole index hook and keeps a title it would empty", async () => {
		await writeMemory("project_chart.md", memory("Chart", "Body."), 3)
		await writeMemory("project_audit.md", memory("Audit", "The CHART-FIX branch was merged into main."), 1)
		await fs.writeFile(
			path.join(dir, "MEMORY.md"),
			"- [CHART-FIX branch unmerged](project_chart.md): CHART-FIX branch STILL unmerged\n",
		)
		const { calls, query } = stubQuery("DONE")
		await run(query)
		// One clause from the title, one from the hook.
		expect(calls).toHaveLength(2)
		expect(await fs.readFile(path.join(dir, "MEMORY.md"), "utf-8")).toBe(
			"- [CHART-FIX branch unmerged](project_chart.md): CHART-FIX branch STILL unmerged " +
				"[resolved 2026-10-01: newer note project_audit.md says so]\n",
		)
	})

	it("never checks feedback or user memories, which hold rules and not project state", async () => {
		await writeMemory("feedback_tokens.md", memory("Rule", "VSIX rebuild still owed."), 5)
		await writeMemory("user_tokens.md", memory("Pref", "VSIX rebuild still owed."), 5)
		await writeMemory("project_audit.md", memory("Audit", "VSIX rebuilt from main."), 3)
		const { calls, query } = stubQuery("DONE")
		expect(await run(query)).toEqual([])
		expect(calls).toHaveLength(0)
	})

	it("stops with 'aborted' before the next question once the signal fires", async () => {
		const body = [101, 102].map((n) => `- #${n} not merged yet.`).join("\n")
		await writeMemory("project_many.md", memory("Many fixes", body), 3)
		const controller = new AbortController()
		const { calls, query } = stubQuery(() => {
			controller.abort()
			return "STILL"
		})
		const ev = stubEvidence(() => true)
		await expect(run(query, { evidence: ev.evidence, signal: controller.signal })).rejects.toThrow("aborted")
		expect(calls).toHaveLength(1)
		// The answer already given is kept.
		expect(Object.keys((await readState()).checks)).toHaveLength(1)
	})
})
