import {
	TOOL_PAYLOAD_KINDS,
	describeToolPayload,
	formatToolPayloadBytes,
	getToolPayloadKind,
	parseToolPayloadText,
	toolPayloadDiffText,
	toolPayloadReadSummary,
	toolPayloadSearchScope,
	toolPayloadSubject,
} from "../toolPayload.js"

describe("getToolPayloadKind", () => {
	it("knows every name the extension sends and the legacy edit names", () => {
		expect(Object.fromEntries(TOOL_PAYLOAD_KINDS)).toEqual({
			editedExistingFile: "edit",
			appliedDiff: "edit",
			newFileCreated: "edit",
			searchAndReplace: "edit",
			search_and_replace: "edit",
			search_replace: "edit",
			edit: "edit",
			edit_file: "edit",
			apply_patch: "edit",
			apply_diff: "edit",
			insertContent: "insert",
			codebaseSearch: "codebaseSearch",
			readFile: "readFile",
			readArtifact: "readArtifact",
			readCommandOutput: "readArtifact",
			listFilesTopLevel: "listFiles",
			listFilesRecursive: "listFiles",
			listFiles: "listFiles",
			searchFiles: "searchFiles",
			searchTaskHistory: "searchTaskHistory",
			switchMode: "switchMode",
			newTask: "newTask",
			finishTask: "finishTask",
			reviewPlan: "reviewPlan",
			generateImage: "generateImage",
			imageGenerated: "generateImage",
			runSlashCommand: "runSlashCommand",
			updateTodoList: "updateTodoList",
			skill: "skill",
			webSearch: "webSearch",
			webFetch: "webFetch",
			runParallelTasks: "runParallelTasks",
		})
	})

	it("has no kind for other names, a non-string, or a prototype key", () => {
		expect(getToolPayloadKind("read_file")).toBeUndefined()
		expect(getToolPayloadKind(undefined)).toBeUndefined()
		expect(getToolPayloadKind(42)).toBeUndefined()
		expect(getToolPayloadKind("constructor")).toBeUndefined()
		expect(getToolPayloadKind("__proto__")).toBeUndefined()
	})
})

describe("parseToolPayloadText", () => {
	it("returns the JSON object", () => {
		expect(parseToolPayloadText('{"tool":"readFile","path":"a.ts"}')).toEqual({ tool: "readFile", path: "a.ts" })
	})

	it.each([undefined, null, "", "not json", '{"tool":', "[1,2]", '"text"', "42", "null"])(
		"returns undefined for %j",
		(text) => {
			expect(parseToolPayloadText(text)).toBeUndefined()
		},
	)
})

describe("describeToolPayload", () => {
	it("keeps typed fields and drops the ones of the wrong type", () => {
		expect(
			describeToolPayload({
				tool: "appliedDiff",
				path: "src/a.ts",
				diff: "d",
				content: "c",
				isProtected: "yes",
				diffStats: { added: 1, removed: "2" },
				lineNumber: 3,
				toolCallId: "call_1",
			}),
		).toEqual({
			tool: "appliedDiff",
			kind: "edit",
			subject: "src/a.ts",
			path: "src/a.ts",
			diff: "d",
			content: "c",
			lineNumber: 3,
		})
	})

	it("names a payload without a tool unknown", () => {
		expect(describeToolPayload({ path: "a.ts" })).toEqual({ tool: "unknown", subject: "a.ts", path: "a.ts" })
	})

	it("normalizes a batch read, from batchFiles or the older files", () => {
		const file = {
			path: "b.ts",
			lineSnippet: "lines 1-2",
			isOutsideWorkspace: true,
			key: "b.ts (lines 1-2)",
			content: "/b.ts",
		}
		expect(
			describeToolPayload({ tool: "readFile", batchFiles: [file, { lineSnippet: "" }, "junk"] }).batchFiles,
		).toEqual([file, { path: "", lineSnippet: "" }])
		expect(describeToolPayload({ tool: "readFile", files: [{ path: "a.ts" }] }).batchFiles).toEqual([
			{ path: "a.ts" },
		])
	})

	it("normalizes a batch of edits", () => {
		expect(
			describeToolPayload({
				tool: "appliedDiff",
				batchDiffs: [
					{
						path: "a.ts",
						changeCount: 2,
						key: "a.ts",
						content: "x",
						diffStats: { added: 1, removed: 0 },
						diffs: [{ content: "h", startLine: 4 }, { content: "i" }],
					},
				],
			}).batchDiffs,
		).toEqual([
			{
				path: "a.ts",
				changeCount: 2,
				key: "a.ts",
				content: "x",
				diffStats: { added: 1, removed: 0 },
				diffs: [{ content: "h", startLine: 4 }, { content: "i" }],
			},
		])
	})

	it("keeps only the string queries of a web search", () => {
		expect(describeToolPayload({ tool: "webSearch", queries: ["a", 1, "b"] })).toMatchObject({
			queries: ["a", "b"],
			subject: "a, b",
		})
	})
})

describe("toolPayloadSubject", () => {
	it.each([
		[{ tool: "readFile", path: "src/a.ts" }, "src/a.ts"],
		[{ tool: "editedExistingFile", path: "src/a.ts" }, "src/a.ts"],
		[{ tool: "listFilesRecursive", path: "src" }, "src"],
		[{ tool: "generateImage", path: "cat.png" }, "cat.png"],
		[{ tool: "reviewPlan", path: "plan.md" }, "plan.md"],
		[{ tool: "searchFiles", path: "src", regex: "TODO" }, "TODO"],
		[{ tool: "codebaseSearch", path: "src", query: "auth" }, "auth"],
		[{ tool: "searchTaskHistory", query: "port" }, "port"],
		[{ tool: "webSearch", queries: ["a", "b"] }, "a, b"],
		[{ tool: "webFetch", fetchedUrl: "https://x.test" }, "https://x.test"],
		[{ tool: "switchMode", mode: "code", reason: "r" }, "code"],
		[{ tool: "newTask", mode: "ask", content: "c" }, "ask"],
		[{ tool: "skill", skill: "pdf" }, "pdf"],
		[{ tool: "runSlashCommand", command: "deploy" }, "/deploy"],
		[{ tool: "readArtifact", totalBytes: 10 }, "10 B"],
		[{ tool: "somethingNew", path: "x" }, "x"],
		[{ tool: "finishTask", path: "x" }, undefined],
		[{ tool: "runParallelTasks" }, undefined],
		[{ tool: "webSearch", queries: [] }, undefined],
		[{ tool: "runSlashCommand" }, undefined],
	])("%j -> %j", (payload, subject) => {
		expect(toolPayloadSubject(describeToolPayload(payload))).toBe(subject)
		expect(describeToolPayload(payload).subject).toBe(subject)
	})
})

describe("derived values", () => {
	it("prefers the unified diff in content over diff", () => {
		expect(toolPayloadDiffText({ content: "unified", diff: "search/replace" })).toBe("unified")
		expect(toolPayloadDiffText({ diff: "search/replace" })).toBe("search/replace")
		expect(toolPayloadDiffText({ content: "", diff: "d" })).toBe("")
		expect(toolPayloadDiffText({})).toBeUndefined()
	})

	it("labels a search scope", () => {
		expect(toolPayloadSearchScope({ path: "src", filePattern: "*.ts" })).toBe("src/(*.ts)")
		expect(toolPayloadSearchScope({ path: "src" })).toBe("src")
		expect(toolPayloadSearchScope({})).toBe("")
	})

	it("formats byte counts", () => {
		expect(formatToolPayloadBytes(512)).toBe("512 B")
		expect(formatToolPayloadBytes(1536)).toBe("1.5 KB")
		expect(formatToolPayloadBytes(2 * 1024 * 1024)).toBe("2.0 MB")
	})

	it("summarizes an artifact read", () => {
		expect(toolPayloadReadSummary({ searchPattern: "err", matchCount: 1 })).toBe('search: "err" • 1 match')
		expect(toolPayloadReadSummary({ searchPattern: "err", matchCount: 3 })).toBe('search: "err" • 3 matches')
		expect(toolPayloadReadSummary({ searchPattern: "err" })).toBe('search: "err"')
		expect(toolPayloadReadSummary({ readStart: 0, readEnd: 1024, totalBytes: 4096 })).toBe("0 B - 1.0 KB of 4.0 KB")
		expect(toolPayloadReadSummary({ totalBytes: 2048 })).toBe("2.0 KB")
		expect(toolPayloadReadSummary({})).toBe("")
	})
})
