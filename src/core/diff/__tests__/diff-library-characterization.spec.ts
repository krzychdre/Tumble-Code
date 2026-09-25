// Characterization of every extension-side use of the `diff` package (jsdiff):
// the pretty patch the edit tools show and send to the model
// (formatResponse.createPrettyPatch), the new-file patch
// (convertNewFileToUnifiedDiff), the sanitize-then-count pipeline that fills
// `diffStats` (sanitizeUnifiedDiff + computeDiffStats), and parsing of patches
// written by other tools. Written before DEP-6 (diff 5.x to 9.x) with the
// real library and expected to pass unchanged on both majors.

import { formatResponse } from "../../prompts/responses"
import { computeDiffStats, computeUnifiedDiffStats, convertNewFileToUnifiedDiff, sanitizeUnifiedDiff } from "../stats"

// The same order the edit tools use: pretty patch, sanitize, count.
function toolDiff(relPath: string, oldStr: string | undefined, newStr: string | undefined) {
	const patch = sanitizeUnifiedDiff(formatResponse.createPrettyPatch(relPath, oldStr, newStr))
	return { patch, stats: computeDiffStats(patch) }
}

const prettyPatchCases: Array<[string, string | undefined, string | undefined]> = [
	["one changed line", "a\nb\nc\n", "a\nB\nc\n"],
	// Equal edit distance either way: the order of the - and + lines depends on
	// the library's Myers implementation (diff 6+, jsdiff #439, deletes first).
	["swapped neighbours", "a\nb\nc\nd\n", "a\nc\nb\nd\n"],
	["repeated lines", "x\ny\nx\ny\nx\n", "y\nx\ny\nx\ny\n"],
	["old file without trailing newline", "a\nb", "a\nb\nc\n"],
	["new file without trailing newline", "a\nb\n", "a\nc"],
	["neither with a trailing newline", "a\nb", "a\nc"],
	["new file from empty", "", "first\nsecond\n"],
	// diff 5 also wrote a bogus "\\ No newline at end of file" marker here (a blank
	// line after sanitizing); diff 6+ (jsdiff #535) does not.
	["file emptied", "first\nsecond\n", ""],
	["undefined contents", undefined, undefined],
	["CRLF on both sides", "a\r\nb\r\nc\r\n", "a\r\nX\r\nc\r\n"],
	["CRLF to LF", "a\r\nb\r\n", "a\nb\n"],
	[
		"two hunks far apart",
		Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
		Array.from({ length: 20 }, (_, i) => (i === 1 || i === 17 ? `LINE ${i + 1}` : `line ${i + 1}`)).join("\n") +
			"\n",
	],
	[
		"lines that look like patch headers",
		"-- a sql comment\n++counter\nkeep\n",
		"--- not a header\n+++ nor this\nkeep\n",
	],
	// diff 5 parsePatch split lines on \v, \f, NEL and a lone \r, so these counted
	// 0/0; diff 6+ (jsdiff #435) splits on \n only and counts 1/1.
	["control characters inside lines", "a\vb\nc\fd\ne\x85f\n", "a\vb\nC\fd\ne\x85f\n"],
	["a lone carriage return inside a line", "a\rb\nc\n", "a\rb\nC\n"],
]

describe("diff library characterization (extension)", () => {
	describe("formatResponse.createPrettyPatch + sanitizeUnifiedDiff + computeDiffStats", () => {
		it.each(prettyPatchCases)("%s", (_name, oldStr, newStr) => {
			expect(toolDiff("src/a.ts", oldStr, newStr)).toMatchSnapshot()
		})

		it.each([
			"src/my file.ts",
			"src/zażółć gęślą.ts",
			'src/quote"and\\backslash.ts',
			"src\\windows\\path.ts",
			"src/tab\there.ts",
		])("drops the file headers whatever the file name (%s)", (relPath) => {
			const { patch } = toolDiff(relPath, "a\n", "b\n")
			expect(patch).toBe("@@ -1,1 +1,1 @@\n-a\n+b\n")
		})
	})

	describe("convertNewFileToUnifiedDiff + computeDiffStats", () => {
		it.each([
			["lines with a trailing newline", "a\nb\n", "src/new.ts"],
			["lines without a trailing newline", "a\nb", "src/new.ts"],
			["empty content", "", "src/new.ts"],
			["a single newline", "\n", "src/new.ts"],
			["CRLF content", "a\r\nb\r\n", "src/new.ts"],
			["no file name", "a\n", undefined],
			["a file name with spaces", "a\n", "src/my file.ts"],
			["a non-ASCII file name", "a\n", "src/zażółć gęślą.ts"],
			["a file name with a quote and a backslash", "a\n", 'src/quote"and\\backslash.ts'],
			["a file name with a tab", "a\n", "src/tab\there.ts"],
		])("%s", (_name, content, filePath) => {
			const patch = convertNewFileToUnifiedDiff(content, filePath)
			expect({ patch, stats: computeDiffStats(sanitizeUnifiedDiff(patch)) }).toMatchSnapshot()
		})
	})

	describe("computeUnifiedDiffStats on patches written elsewhere", () => {
		it.each([
			[
				"a git diff with extended headers",
				"diff --git a/src/a.ts b/src/a.ts\nindex 83db48f..bf269f4 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n",
			],
			[
				"two files",
				"--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-x\n+y\n--- a/y.ts\n+++ b/y.ts\n@@ -1,2 +1,3 @@\n k\n+n\n+m\n-o\n",
			],
			["a CRLF patch", "--- a/x.ts\r\n+++ b/x.ts\r\n@@ -1,2 +1,2 @@\r\n a\r\n-b\r\n+c\r\n"],
			["only a hunk", "@@ -3,2 +3,2 @@\n ctx\n-old\n+new\n"],
			[
				"a patch with a no-newline marker",
				"--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n",
			],
			["an empty string", ""],
			["not a patch", "hello world"],
		])("%s", (_name, patch) => {
			expect(computeUnifiedDiffStats(patch)).toMatchSnapshot()
		})
	})
})
