// The rows DiffView renders from parseUnifiedDiff (which wraps jsdiff's
// parsePatch), for the tool patches and for the merged patch FileChangesPanel
// builds with createTwoFilesPatch. The real library runs; the patch text it
// writes is its own business, the rows (line numbers, file selection, CRLF,
// no-newline markers) are ours.

import { createTwoFilesPatch } from "diff"

import { type DiffLine, parseUnifiedDiff } from "../parseUnifiedDiff"

// The same call FileChangesPanel makes for a file with a merged diff.
function mergedPanelPatch(path: string, originalContent: string, finalContent: string) {
	return createTwoFilesPatch(path, path, originalContent, finalContent)
}

// What the edit tools send to the webview: the pretty patch without its four
// header lines, with the no-newline markers blanked out (sanitizeUnifiedDiff).
const toolPatch = "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n"
const toolPatchWithBlankedMarker = "@@ -1,2 +1,2 @@\n a\n-b\n\n+c\n\n"

// Recorded with diff 5.2.2, except where a comment says otherwise.
const expectedPanel: Record<string, DiffLine[]> = {
	"no trailing newline": [
		{
			oldLineNum: 1,
			newLineNum: 1,
			type: "context",
			content: "a",
		},
		{
			oldLineNum: 2,
			newLineNum: null,
			type: "deletion",
			content: "b",
		},
		{
			oldLineNum: 3,
			newLineNum: 2,
			type: "context",
			content: " No newline at end of file",
		},
		{
			oldLineNum: null,
			newLineNum: 3,
			type: "addition",
			content: "c",
		},
		{
			oldLineNum: 4,
			newLineNum: 4,
			type: "context",
			content: " No newline at end of file",
		},
	],
	"an empty original": [
		{
			oldLineNum: null,
			newLineNum: 1,
			type: "addition",
			content: "x",
		},
		{
			oldLineNum: null,
			newLineNum: 2,
			type: "addition",
			content: "y",
		},
	],
	"a relative ./ path": [
		{
			oldLineNum: 1,
			newLineNum: null,
			type: "deletion",
			content: "a",
		},
		{
			oldLineNum: null,
			newLineNum: 1,
			type: "addition",
			content: "b",
		},
	],
	"a file name with spaces": [
		{
			oldLineNum: 1,
			newLineNum: null,
			type: "deletion",
			content: "a",
		},
		{
			oldLineNum: null,
			newLineNum: 1,
			type: "addition",
			content: "b",
		},
	],
	// diff 9 C-quotes and octal-escapes such names in the ---/+++ headers. The
	// panel only renders the parsed rows (unchanged), never the header text.
	"a non-ASCII file name": [
		{
			oldLineNum: 1,
			newLineNum: null,
			type: "deletion",
			content: "a",
		},
		{
			oldLineNum: null,
			newLineNum: 1,
			type: "addition",
			content: "b",
		},
	],
	// diff 9 quotes and escapes the name in the headers; the rows are unchanged.
	"a file name with a quote and a backslash": [
		{
			oldLineNum: 1,
			newLineNum: null,
			type: "deletion",
			content: "a",
		},
		{
			oldLineNum: null,
			newLineNum: 1,
			type: "addition",
			content: "b",
		},
	],
	"CRLF content": [
		{
			oldLineNum: 1,
			newLineNum: 1,
			type: "context",
			content: "a",
		},
		{
			oldLineNum: 2,
			newLineNum: null,
			type: "deletion",
			content: "b",
		},
		{
			oldLineNum: null,
			newLineNum: 2,
			type: "addition",
			content: "X",
		},
	],
}

// Recorded with diff 5.2.2, except where a comment says otherwise.
const expectedRows: Record<string, DiffLine[]> = {
	"a tool patch": [
		{
			oldLineNum: 1,
			newLineNum: 1,
			type: "context",
			content: "a",
		},
		{
			oldLineNum: 2,
			newLineNum: null,
			type: "deletion",
			content: "b",
		},
		{
			oldLineNum: null,
			newLineNum: 2,
			type: "addition",
			content: "B",
		},
		{
			oldLineNum: 3,
			newLineNum: 3,
			type: "context",
			content: "c",
		},
	],
	// diff 5 rendered each blanked marker as an extra numbered context row; diff
	// 6+ rejects the patch (line counts), so parseUnifiedDiff drops the empty
	// lines and retries: the real rows only.
	"a tool patch with blanked no-newline markers": [
		{
			oldLineNum: 1,
			newLineNum: 1,
			type: "context",
			content: "a",
		},
		{
			oldLineNum: 2,
			newLineNum: null,
			type: "deletion",
			content: "b",
		},
		{
			oldLineNum: null,
			newLineNum: 2,
			type: "addition",
			content: "c",
		},
	],
	"two hunks (gap row)": [
		{
			oldLineNum: 1,
			newLineNum: null,
			type: "deletion",
			content: "a",
		},
		{
			oldLineNum: null,
			newLineNum: 1,
			type: "addition",
			content: "A",
		},
		{
			oldLineNum: 2,
			newLineNum: 2,
			type: "context",
			content: "b",
		},
		{
			oldLineNum: null,
			newLineNum: null,
			type: "gap",
			content: "",
			hiddenCount: 7,
		},
		{
			oldLineNum: 10,
			newLineNum: 10,
			type: "context",
			content: "c",
		},
		{
			oldLineNum: 11,
			newLineNum: null,
			type: "deletion",
			content: "d",
		},
		{
			oldLineNum: null,
			newLineNum: 11,
			type: "addition",
			content: "D",
		},
	],
	"a multi-file patch, second file selected by path suffix": [
		{
			oldLineNum: 1,
			newLineNum: null,
			type: "deletion",
			content: "o",
		},
		{
			oldLineNum: null,
			newLineNum: 1,
			type: "addition",
			content: "p",
		},
	],
	"a multi-file patch, unknown path falls back to the first file": [
		{
			oldLineNum: 1,
			newLineNum: null,
			type: "deletion",
			content: "x",
		},
		{
			oldLineNum: null,
			newLineNum: 1,
			type: "addition",
			content: "y",
		},
	],
	"a git diff with extended headers": [
		{
			oldLineNum: 1,
			newLineNum: 1,
			type: "context",
			content: "a",
		},
		{
			oldLineNum: 2,
			newLineNum: null,
			type: "deletion",
			content: "b",
		},
		{
			oldLineNum: null,
			newLineNum: 2,
			type: "addition",
			content: "c",
		},
	],
	"a CRLF patch": [
		{
			oldLineNum: 1,
			newLineNum: 1,
			type: "context",
			content: "a",
		},
		{
			oldLineNum: 2,
			newLineNum: null,
			type: "deletion",
			content: "b",
		},
		{
			oldLineNum: null,
			newLineNum: 2,
			type: "addition",
			content: "c",
		},
	],
	"a patch with no-newline markers": [
		{
			oldLineNum: 1,
			newLineNum: null,
			type: "deletion",
			content: "a",
		},
		{
			oldLineNum: 2,
			newLineNum: 1,
			type: "context",
			content: " No newline at end of file",
		},
		{
			oldLineNum: null,
			newLineNum: 2,
			type: "addition",
			content: "b",
		},
		{
			oldLineNum: 3,
			newLineNum: 3,
			type: "context",
			content: " No newline at end of file",
		},
	],
	"an empty string": [],
	"not a patch": [],
}

describe("parseUnifiedDiff", () => {
	describe("the merged patch of FileChangesPanel", () => {
		it.each([
			["no trailing newline", "src/a.ts", "a\nb", "a\nc"],
			["an empty original", "src/a.ts", "", "x\ny\n"],
			["a relative ./ path", "./src/a.ts", "a\n", "b\n"],
			["a file name with spaces", "src/my file.ts", "a\n", "b\n"],
			["a non-ASCII file name", "src/zażółć gęślą.ts", "a\n", "b\n"],
			["a file name with a quote and a backslash", 'src/quote"and\\backslash.ts', "a\n", "b\n"],
			["CRLF content", "src/a.ts", "a\r\nb\r\n", "a\r\nX\r\n"],
		])("%s", (_name, path, originalContent, finalContent) => {
			const patch = mergedPanelPatch(path, originalContent, finalContent)
			expect(parseUnifiedDiff(patch, path)).toEqual(expectedPanel[_name])
		})
	})

	describe("tool and git patches", () => {
		it.each([
			["a tool patch", toolPatch, undefined],
			["a tool patch with blanked no-newline markers", toolPatchWithBlankedMarker, undefined],
			["two hunks (gap row)", "@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -10,2 +10,2 @@\n c\n-d\n+D\n", undefined],
			[
				"a multi-file patch, second file selected by path suffix",
				"--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-x\n+y\n--- a/src/y.ts\n+++ b/src/y.ts\n@@ -1 +1 @@\n-o\n+p\n",
				"src/y.ts",
			],
			[
				"a multi-file patch, unknown path falls back to the first file",
				"--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-x\n+y\n--- a/y.ts\n+++ b/y.ts\n@@ -1 +1 @@\n-o\n+p\n",
				"nope.ts",
			],
			[
				"a git diff with extended headers",
				"diff --git a/src/a.ts b/src/a.ts\nindex 83db48f..bf269f4 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n",
				"src/a.ts",
			],
			["a CRLF patch", "--- a/x.ts\r\n+++ b/x.ts\r\n@@ -1,2 +1,2 @@\r\n a\r\n-b\r\n+c\r\n", "x.ts"],
			[
				"a patch with no-newline markers",
				"--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n",
				"x",
			],
			["an empty string", "", undefined],
			["not a patch", "hello world", undefined],
		])("%s", (_name, source, filePath) => {
			expect(parseUnifiedDiff(source, filePath)).toEqual(expectedRows[_name])
		})
	})
})
