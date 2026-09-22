import { advanceStreamCommit, committableLines, committedText, remainderAfterCommit } from "../streamCommit.js"

describe("committableLines", () => {
	it("counts only lines followed by a newline", () => {
		expect(committableLines("")).toBe(0)
		expect(committableLines("half a line")).toBe(0)
		expect(committableLines("one\n")).toBe(1)
		expect(committableLines("one\ntwo\nthr")).toBe(2)
	})

	it("stops before a fenced block that is still open", () => {
		expect(committableLines("intro\n```ts\nconst a = 1\n")).toBe(1)
		expect(committableLines("intro\n```ts\nconst a = 1\n```\nafter")).toBe(4)
	})

	it("matches a closing fence of the same kind only", () => {
		expect(committableLines("~~~\n```\nstill code\n")).toBe(0)
		expect(committableLines("~~~\n```\n~~~\n")).toBe(3)
	})
})

describe("advanceStreamCommit", () => {
	it("prints each finished line once, in order", () => {
		const first = advanceStreamCommit("Para one.\nPara tw", undefined)
		expect(first).toEqual({ chunks: ["Para one."], lines: 1 })

		expect(advanceStreamCommit("Para one.\nPara two, still", first)).toBeUndefined()

		const second = advanceStreamCommit("Para one.\nPara two.\n\nPara th", first)
		expect(second).toEqual({ chunks: ["Para one.", "Para two.\n"], lines: 3 })
		expect(committedText(second!)).toBe("Para one.\nPara two.\n")
	})

	it("refuses to extend a prefix the content no longer starts with", () => {
		const commit = { chunks: ["Old first line"], lines: 1 }
		expect(advanceStreamCommit("Rewritten first line\nmore\n", commit)).toBeUndefined()
	})
})

describe("remainderAfterCommit", () => {
	it("returns what follows the printed lines", () => {
		const commit = { chunks: ["Para one.", "Para two.\n"], lines: 3 }
		expect(remainderAfterCommit("Para one.\nPara two.\n\nPara three.", commit)).toBe("Para three.")
		expect(remainderAfterCommit("Para one.\nPara two.\n\n", commit)).toBe("")
	})

	it("returns the whole content when nothing was printed", () => {
		expect(remainderAfterCommit("text", { chunks: [], lines: 0 })).toBe("text")
	})

	it("returns null when the content diverged", () => {
		expect(remainderAfterCommit("Something else\n", { chunks: ["Para one."], lines: 1 })).toBeNull()
	})
})
