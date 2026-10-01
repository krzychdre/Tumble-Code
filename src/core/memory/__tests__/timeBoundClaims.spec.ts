import {
	allRefsLanded,
	annotateClause,
	describeRef,
	dropResolvedClause,
	extractRefs,
	findTimeBoundClauses,
	isTimeBound,
	refsNearMarker,
	removeClause,
	RESOLVED_MARKER,
} from "../timeBoundClaims"

describe("isTimeBound", () => {
	it.each([
		"VSIX rebuild still owed",
		"fix/cloud-daily-chart-axis STILL unmerged",
		"api image rebuild STILL OWED",
		"user must run agent-bench + Z.ai cache probe before WS-7/8",
		"open: mode-switch prune-leak trace",
		"not pushed",
		"3 follow-upy",
		"deferred until the bench run",
		"pending merge of the stack",
		"jeszcze nie zmergowane",
		"was not merged to main at time of writing",
		"STILL not rebuilt",
		"jeszcze nie zrobione",
		"VSIX nie jest przebudowany",
		"VSIX is STALE vs main",
		"dopóki VSIX nie zostanie przebudowany",
		"branch niezmergowany",
		"wdrożenie odłożone na później",
		"na razie tylko lokalnie",
	])("flags %j", (clause) => {
		expect(isTimeBound(clause)).toBe(true)
	})

	it.each([
		"MERGED #570",
		"Faza 1 UI modernization merged 2026-09-28 (5d16d4134)",
		"gate on pending only + relabel text say in place",
		"drain blocked abort",
		"knip exits 1 inside .claude/worktrees",
		"ink useInput stale closure (read via refs)",
		"All benchmark artifacts are ephemeral and intentionally unmerged",
		"branch zostaje celowo niezmergowany",
		"nie mów do mnie",
		"Never undo a temporary edit on the live tree",
		"stable head, deferred-tools catalog LAST",
		"MERGED as #156 (squash, branch looked unmerged)",
		"Follow-up item from the plan, completed 2026-09-26",
	])("does not flag %j", (clause) => {
		expect(isTimeBound(clause)).toBe(false)
	})

	it("ignores a clause the dream already resolved", () => {
		expect(isTimeBound(`VSIX rebuild owed ${RESOLVED_MARKER}2026-10-01: x]`)).toBe(false)
	})
})

describe("findTimeBoundClauses", () => {
	it("cuts a description at semicolons and returns only the time-bound clauses", () => {
		expect(
			findTimeBoundClauses("Faza 1 UI modernization merged 2026-09-28 (5d16d4134); VSIX rebuild still owed."),
		).toEqual(["VSIX rebuild still owed."])
	})

	it("cuts at spaced dashes (hyphen, en and em) and sentence ends", () => {
		const text = "MERGED #541-#544 (2026-09-27) \u2014 VSIX rebuild owed. Other fact here \u2013 3 follow-upy"
		expect(findTimeBoundClauses(text)).toEqual(["VSIX rebuild owed.", "3 follow-upy"])
	})

	it("keeps unspaced hyphens inside a clause", () => {
		expect(findTimeBoundClauses("fix/cloud-daily-chart-axis STILL unmerged 2026-10-01")).toEqual([
			"fix/cloud-daily-chart-axis STILL unmerged 2026-10-01",
		])
	})

	it("strips list bullets and headings, skips fenced code, drops duplicates", () => {
		const body = [
			"## Still open: the trace",
			"- not pushed yet",
			"```",
			"pending merge inside code",
			"```",
			"* not pushed yet",
		].join("\n")
		expect(findTimeBoundClauses(body)).toEqual(["Still open: the trace", "not pushed yet"])
	})

	it("returns exact substrings of the input", () => {
		const body = "Intro.\n- **Trap:** the api image rebuild is STILL OWED; rest"
		for (const clause of findTimeBoundClauses(body)) expect(body).toContain(clause)
	})

	it("skips over-long clauses", () => {
		expect(findTimeBoundClauses(`not merged ${"x".repeat(500)}`)).toEqual([])
	})
})

describe("extractRefs", () => {
	it("finds PRs, commits, branches and repo paths in order", () => {
		expect(
			extractRefs("fix/cloud-daily-chart-axis unmerged, conflicts with #654 (8437ea7e6), see ai_plans/x-plan.md"),
		).toEqual([
			{ kind: "branch", name: "fix/cloud-daily-chart-axis" },
			{ kind: "pr", number: 654 },
			{ kind: "commit", sha: "8437ea7e6" },
			{ kind: "file", path: "ai_plans/x-plan.md" },
		])
	})

	it("reads every PR of a range and drops duplicates", () => {
		expect(extractRefs("MERGED #588/#593/#601+#602 and #588 again")).toEqual([
			{ kind: "pr", number: 588 },
			{ kind: "pr", number: 593 },
			{ kind: "pr", number: 601 },
			{ kind: "pr", number: 602 },
		])
	})

	it("does not read dates, plain numbers or words as commits", () => {
		expect(extractRefs("merged 2026-09-28, 20260928, deadbeefcafe, 1234567")).toEqual([])
	})

	it("ignores absolute paths and URLs", () => {
		expect(
			extractRefs("see /opt/docker/llm/compose.yml and https://github.com/a/b.git and ~/.roo/cli/x.json"),
		).toEqual([])
	})

	it("reads a branch-like path with a file extension as a file", () => {
		expect(extractRefs("see docs/plan.md and docs/refactor-plan-2026-09-24")).toEqual([
			{ kind: "file", path: "docs/plan.md" },
			{ kind: "branch", name: "docs/refactor-plan-2026-09-24" },
		])
	})

	it("does not read a hex-looking branch suffix as a commit", () => {
		expect(extractRefs("feat/ab12cd3 not merged")).toEqual([{ kind: "branch", name: "feat/ab12cd3" }])
	})

	it("caps the number of references", () => {
		expect(extractRefs("#1 #2 #3 #4 #5 #6 #7 #8")).toHaveLength(6)
	})

	it("labels refs for prompts", () => {
		expect(describeRef({ kind: "pr", number: 5 })).toBe("PR #5")
		expect(describeRef({ kind: "branch", name: "fix/x" })).toBe("branch fix/x")
	})
})

describe("removeClause", () => {
	it("removes a trailing clause with its separator", () => {
		expect(
			removeClause(
				"Faza 1 UI modernization merged 2026-09-28 (5d16d4134); VSIX rebuild still owed.",
				"VSIX rebuild still owed.",
			),
		).toBe("Faza 1 UI modernization merged 2026-09-28 (5d16d4134)")
	})

	it("removes a middle clause and keeps the rest", () => {
		expect(removeClause("MERGED #541; VSIX rebuild owed; 3 notes", "VSIX rebuild owed")).toBe(
			"MERGED #541; 3 notes",
		)
	})

	it("removes a leading clause", () => {
		expect(removeClause("STILL unmerged \u2014 conflicts with #654", "STILL unmerged")).toBe("conflicts with #654")
	})

	it("returns empty text when the clause was everything", () => {
		expect(removeClause("not pushed", "not pushed")).toBe("")
	})

	it("leaves the text alone when the clause is not a whole part", () => {
		expect(removeClause("a; b c", "b")).toBe("a; b c")
	})
})

describe("annotateClause", () => {
	it("puts the note before the trailing punctuation so the clause stays marked", () => {
		const text = "Body line: VSIX rebuild still owed. Next sentence."
		const out = annotateClause(text, "VSIX rebuild still owed.", "2026-10-01: PR #570 is on main")
		expect(out).toBe(
			`Body line: VSIX rebuild still owed ${RESOLVED_MARKER}2026-10-01: PR #570 is on main]. Next sentence.`,
		)
		expect(findTimeBoundClauses(out)).toEqual([])
	})

	it("neutralises sentence ends and brackets inside the note", () => {
		const out = annotateClause("x not pushed", "not pushed", "done. really] ok.")
		expect(out).toBe(`x not pushed ${RESOLVED_MARKER}done, really) ok]`)
		expect(findTimeBoundClauses(out)).toEqual([])
	})

	it("leaves the text alone when the clause is absent", () => {
		expect(annotateClause("abc", "not pushed", "n")).toBe("abc")
	})
})

describe("allRefsLanded", () => {
	const pr = { kind: "pr", number: 1 } as const
	const branch = { kind: "branch", name: "fix/x" } as const
	const ev = (ref: typeof pr | typeof branch, landed: boolean | undefined) => ({ ref, landed, text: "t" })

	it("needs at least one ref", () => {
		expect(allRefsLanded([], [ev(pr, true)])).toBe(false)
	})

	it("does not let an existing file alone open the gate", () => {
		const file = { kind: "file", path: "src/a.ts" } as const
		expect(allRefsLanded([file], [{ ref: file, landed: true, text: "t" }])).toBe(false)
		expect(allRefsLanded([pr, file], [ev(pr, true), { ref: file, landed: true, text: "t" }])).toBe(true)
	})

	it("needs every ref landed", () => {
		expect(allRefsLanded([pr, branch], [ev(pr, true), ev(branch, true)])).toBe(true)
		expect(allRefsLanded([pr, branch], [ev(pr, true), ev(branch, false)])).toBe(false)
		expect(allRefsLanded([pr, branch], [ev(pr, true), ev(branch, undefined)])).toBe(false)
		expect(allRefsLanded([pr, branch], [ev(pr, true)])).toBe(false)
	})
})

describe("refsNearMarker", () => {
	it("keeps the refs a marker is about and drops the ones further away", () => {
		expect(refsNearMarker("fix/x STILL unmerged")).toEqual([{ kind: "branch", name: "fix/x" }])
		expect(refsNearMarker("#12 is still not merged")).toEqual([{ kind: "pr", number: 12 }])
		expect(refsNearMarker("unmerged: main left at e9d27d10f")).toEqual([])
		expect(refsNearMarker("branch STILL unmerged 2026-10-01 and now CONFLICTS with #654")).toEqual([])
	})

	it("with mergeOnly counts only markers git can settle, and never files", () => {
		expect(refsNearMarker("VSIX rebuild owed for #570", true)).toEqual([])
		expect(refsNearMarker("VSIX rebuild owed for #570")).toEqual([{ kind: "pr", number: 570 }])
		expect(refsNearMarker("fix/x jeszcze nie zmergowane", true)).toEqual([{ kind: "branch", name: "fix/x" }])
		expect(refsNearMarker("docs/a.md not pushed", true)).toEqual([])
	})
})

describe("dropResolvedClause", () => {
	it("drops only a time-bound parenthetical and keeps the still-true rest", () => {
		const hook = "VSIX = main@059bac30c; all doc debts cleared in d55078ec7 (not pushed)."
		expect(dropResolvedClause(hook, "all doc debts cleared in d55078ec7 (not pushed).")).toBe(
			"VSIX = main@059bac30c; all doc debts cleared in d55078ec7.",
		)
		expect(
			dropResolvedClause(
				"DEBTS CLEARED (commit abc1234, not pushed): rows added",
				"DEBTS CLEARED (commit abc1234, not pushed): rows added",
			),
		).toBe("DEBTS CLEARED: rows added")
	})

	it("drops the whole clause when the marker is outside the parenthetical", () => {
		expect(dropResolvedClause("MERGED #5; VSIX rebuild owed (UI)", "VSIX rebuild owed (UI)")).toBe("MERGED #5")
	})
})
