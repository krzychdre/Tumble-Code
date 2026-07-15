import { diffPlanMarkdown, splitMarkdownBlocks } from "../planMarkdownDiff"

describe("splitMarkdownBlocks", () => {
	it("splits on blank lines", () => {
		expect(splitMarkdownBlocks("# Title\n\npara one\n\npara two")).toEqual(["# Title", "para one", "para two"])
	})

	it("keeps multi-line blocks together", () => {
		expect(splitMarkdownBlocks("- a\n- b\n- c\n\nnext")).toEqual(["- a\n- b\n- c", "next"])
	})

	it("keeps fenced code with blank lines as one block", () => {
		const md = "```ts\nconst a = 1\n\nconst b = 2\n```\n\nafter"
		expect(splitMarkdownBlocks(md)).toEqual(["```ts\nconst a = 1\n\nconst b = 2\n```", "after"])
	})

	it("handles unterminated fences without losing content", () => {
		const md = "```\ncode\n\nstill code"
		expect(splitMarkdownBlocks(md)).toEqual(["```\ncode\n\nstill code"])
	})
})

describe("diffPlanMarkdown", () => {
	it("returns a single unchanged segment without a baseline", () => {
		expect(diffPlanMarkdown(undefined, "# Plan")).toEqual([{ kind: "same", markdown: "# Plan" }])
	})

	it("returns a single unchanged segment when identical", () => {
		expect(diffPlanMarkdown("# Plan\n\nbody", "# Plan\n\nbody")).toEqual([
			{ kind: "same", markdown: "# Plan\n\nbody" },
		])
	})

	it("returns empty for empty current content", () => {
		expect(diffPlanMarkdown(undefined, "")).toEqual([])
	})

	it("marks an added paragraph as changed", () => {
		const segments = diffPlanMarkdown("# Plan\n\nintro", "# Plan\n\nintro\n\nnew step")
		expect(segments).toEqual([
			{ kind: "same", markdown: "# Plan\n\nintro" },
			{ kind: "changed", markdown: "new step" },
		])
	})

	it("marks a modified paragraph as changed without a removed strip", () => {
		const segments = diffPlanMarkdown("# Plan\n\nold text\n\nend", "# Plan\n\nnew text\n\nend")
		expect(segments).toEqual([
			{ kind: "same", markdown: "# Plan" },
			{ kind: "changed", markdown: "new text" },
			{ kind: "same", markdown: "end" },
		])
	})

	it("marks a pure deletion with a removed strip", () => {
		const segments = diffPlanMarkdown("# Plan\n\ndropped step\n\nend", "# Plan\n\nend")
		expect(segments).toEqual([
			{ kind: "same", markdown: "# Plan" },
			{ kind: "removed", text: "dropped step" },
			{ kind: "same", markdown: "end" },
		])
	})

	it("ignores whitespace-only reflows", () => {
		const segments = diffPlanMarkdown("some  text\nhere", "some text here")
		expect(segments).toEqual([{ kind: "same", markdown: "some text here" }])
	})

	it("merges consecutive changed blocks", () => {
		const segments = diffPlanMarkdown("intro", "intro\n\nstep one\n\nstep two")
		expect(segments).toEqual([
			{ kind: "same", markdown: "intro" },
			{ kind: "changed", markdown: "step one\n\nstep two" },
		])
	})
})
