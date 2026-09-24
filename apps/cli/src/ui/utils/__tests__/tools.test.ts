import { extractToolData } from "../tools.js"

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
