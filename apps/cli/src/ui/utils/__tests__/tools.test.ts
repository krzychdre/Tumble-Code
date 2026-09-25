import { extractToolData, parseTodosFromToolInfo } from "../tools.js"

describe("extractToolData", () => {
	it("keeps the file list of a multi-file read (the extension sends it as batchFiles)", () => {
		// Shape sent by ReadFileTool.requestApproval when a read_file call names
		// more than one file: { tool: "readFile", batchFiles, toolCallId }.
		const data = extractToolData({
			tool: "readFile",
			toolCallId: "call_1",
			batchFiles: [
				{ path: "src/a.ts", lineSnippet: "", key: "src/a.ts", content: "/ws/src/a.ts" },
				{
					path: "../outside/b.ts",
					lineSnippet: "lines 1-20",
					isOutsideWorkspace: true,
					key: "../outside/b.ts (lines 1-20)",
					content: "/outside/b.ts",
				},
			],
		})

		expect(data.batchFiles).toEqual([
			{
				path: "src/a.ts",
				lineSnippet: "",
				isOutsideWorkspace: undefined,
				key: "src/a.ts",
				content: "/ws/src/a.ts",
			},
			{
				path: "../outside/b.ts",
				lineSnippet: "lines 1-20",
				isOutsideWorkspace: true,
				key: "../outside/b.ts (lines 1-20)",
				content: "/outside/b.ts",
			},
		])
	})

	it("still accepts the older `files` field", () => {
		const data = extractToolData({ tool: "readFile", files: [{ path: "a.ts" }] })

		expect(data.batchFiles?.map((f) => f.path)).toEqual(["a.ts"])
	})
})

// CLI-5: UpdateTodoListTool sends the list it parsed, as TodoItem[], in both
// the partial and the final ask (src/core/tools/UpdateTodoListTool.ts). The
// CLI's own markdown checklist parser, with a regex that drifted from the
// extension's (no "- [x]" prefix, no "[~]"), only ever saw strings the
// extension never sends.
describe("parseTodosFromToolInfo", () => {
	it("reads the TodoItem list the extension sends", () => {
		expect(
			parseTodosFromToolInfo({
				tool: "updateTodoList",
				todos: [
					{ id: "a", content: "Plan", status: "completed" },
					{ id: "b", content: "Build", status: "in_progress" },
				],
			}),
		).toEqual([
			{ id: "a", content: "Plan", status: "completed" },
			{ id: "b", content: "Build", status: "in_progress" },
		])
	})

	it("reads no list from a payload without one", () => {
		expect(parseTodosFromToolInfo({ tool: "updateTodoList" })).toBeNull()
		expect(parseTodosFromToolInfo({ tool: "updateTodoList", todos: "[x] Plan\n[-] Build" })).toBeNull()
	})
})
