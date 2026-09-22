import { parseAnyDiff, parseDiff, parseSearchReplaceDiff, isDiffText } from "../utils.js"

describe("parseSearchReplaceDiff", () => {
	it("parses a complete block into removed and added lines", () => {
		const diff = [
			"<<<<<<< SEARCH",
			":start_line:17",
			"-------",
			"    rsa_keygen_bits:1024",
			"=======",
			"    rsa_keygen_bits:2048",
			">>>>>>> REPLACE",
		].join("\n")

		expect(parseSearchReplaceDiff(diff)).toEqual([
			{
				header: "@@ line 17 @@",
				lines: [
					{ type: "removed", content: "    rsa_keygen_bits:1024" },
					{ type: "added", content: "    rsa_keygen_bits:2048" },
				],
			},
		])
	})

	it("parses a block that declares no :start_line:", () => {
		const diff = ["<<<<<<< SEARCH", "-------", "old", "=======", "new", ">>>>>>> REPLACE"].join("\n")

		const hunks = parseSearchReplaceDiff(diff)

		expect(hunks).toHaveLength(1)
		expect(hunks[0]!.header).toBe("")
		expect(hunks[0]!.lines).toEqual([
			{ type: "removed", content: "old" },
			{ type: "added", content: "new" },
		])
	})

	it("parses a block with no ------- fence", () => {
		const diff = ["<<<<<<< SEARCH", "old", "=======", "new", ">>>>>>> REPLACE"].join("\n")

		expect(parseSearchReplaceDiff(diff)[0]!.lines).toEqual([
			{ type: "removed", content: "old" },
			{ type: "added", content: "new" },
		])
	})

	it("ignores :end_line: metadata", () => {
		const diff = [
			"<<<<<<< SEARCH",
			":start_line:5",
			":end_line:6",
			"-------",
			"old",
			"=======",
			"new",
			">>>>>>> REPLACE",
		].join("\n")

		const hunks = parseSearchReplaceDiff(diff)

		expect(hunks[0]!.header).toBe("@@ line 5 @@")
		expect(hunks[0]!.lines.map((l) => l.content)).toEqual(["old", "new"])
	})

	it("tolerates the optional trailing > on the SEARCH marker", () => {
		const diff = ["<<<<<<< SEARCH>", "-------", "old", "=======", "new", ">>>>>>> REPLACE"].join("\n")

		expect(parseSearchReplaceDiff(diff)).toHaveLength(1)
	})

	it("parses several blocks in one payload", () => {
		const diff = [
			"<<<<<<< SEARCH",
			":start_line:1",
			"-------",
			"a",
			"=======",
			"A",
			">>>>>>> REPLACE",
			"<<<<<<< SEARCH",
			":start_line:9",
			"-------",
			"b",
			"=======",
			"B",
			">>>>>>> REPLACE",
		].join("\n")

		const hunks = parseSearchReplaceDiff(diff)

		expect(hunks).toHaveLength(2)
		expect(hunks[0]!.header).toBe("@@ line 1 @@")
		expect(hunks[1]!.header).toBe("@@ line 9 @@")
		expect(hunks[1]!.lines).toEqual([
			{ type: "removed", content: "b" },
			{ type: "added", content: "B" },
		])
	})

	it("emits a block that is still streaming and has no closing marker", () => {
		const diff = ["<<<<<<< SEARCH", ":start_line:3", "-------", "old one", "old two", "======="].join("\n")

		const hunks = parseSearchReplaceDiff(diff)

		expect(hunks).toHaveLength(1)
		expect(hunks[0]!.lines).toEqual([
			{ type: "removed", content: "old one" },
			{ type: "removed", content: "old two" },
		])
	})

	it("keeps a truncated block when the next one starts", () => {
		const diff = [
			"<<<<<<< SEARCH",
			"a",
			"=======",
			"A",
			"<<<<<<< SEARCH",
			"b",
			"=======",
			"B",
			">>>>>>> REPLACE",
		].join("\n")

		const hunks = parseSearchReplaceDiff(diff)

		expect(hunks).toHaveLength(2)
		expect(hunks[0]!.lines.map((l) => l.content)).toEqual(["a", "A"])
	})

	it("unescapes markers that occur inside the payload", () => {
		const diff = [
			"<<<<<<< SEARCH",
			"-------",
			"\\<<<<<<< SEARCH",
			"\\=======",
			"\\:start_line:4",
			"=======",
			"\\>>>>>>> REPLACE",
			"\\-------",
			">>>>>>> REPLACE",
		].join("\n")

		expect(parseSearchReplaceDiff(diff)[0]!.lines).toEqual([
			{ type: "removed", content: "<<<<<<< SEARCH" },
			{ type: "removed", content: "=======" },
			{ type: "removed", content: ":start_line:4" },
			{ type: "added", content: ">>>>>>> REPLACE" },
			{ type: "added", content: "-------" },
		])
	})

	it("drops a block that carries no content yet", () => {
		expect(parseSearchReplaceDiff("<<<<<<< SEARCH\n:start_line:5\n-------")).toEqual([])
	})

	it("returns nothing for text without a SEARCH marker", () => {
		expect(parseSearchReplaceDiff("just some prose\nover two lines")).toEqual([])
	})
})

describe("parseAnyDiff", () => {
	it("routes SEARCH/REPLACE payloads to the block parser", () => {
		const diff = ["<<<<<<< SEARCH", "-------", "old", "=======", "new", ">>>>>>> REPLACE"].join("\n")

		expect(parseAnyDiff(diff)).toEqual(parseSearchReplaceDiff(diff))
	})

	it("routes unified diffs to the unified parser", () => {
		const diff = ["@@ -1,3 +1,3 @@", " context", "-old", "+new"].join("\n")

		expect(parseAnyDiff(diff)).toEqual(parseDiff(diff))
		expect(parseAnyDiff(diff)[0]!.lines).toEqual([
			{ type: "context", content: "context" },
			{ type: "removed", content: "old" },
			{ type: "added", content: "new" },
		])
	})

	it("parses the git-style preamble newFileCreated sends", () => {
		const diff = ["===========", "--- /dev/null", "+++ notes.md", "@@ -0,0 +1,2 @@", "+one", "+two"].join("\n")

		expect(parseAnyDiff(diff)[0]!.lines).toEqual([
			{ type: "added", content: "one" },
			{ type: "added", content: "two" },
		])
	})

	it("does not mistake prose containing @@ for a diff", () => {
		expect(parseAnyDiff("ping @@everyone in the channel")).toEqual([])
		expect(parseAnyDiff("")).toEqual([])
	})
})

describe("isDiffText", () => {
	it("recognises a SEARCH block that has only just started streaming", () => {
		expect(isDiffText("<<<<<<< SEARCH\n:start_line:5\n")).toBe(true)
	})

	it("recognises a unified hunk header", () => {
		expect(isDiffText("@@ -1,3 +1,3 @@\n-old\n+new")).toBe(true)
	})

	it("rejects plain file content", () => {
		expect(isDiffText("# Title\n\nSome prose with an @@ in it.")).toBe(false)
		expect(isDiffText("")).toBe(false)
	})
})
