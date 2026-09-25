import { render } from "ink-testing-library"

import type { TUIMessage } from "../../types.js"
import { extractToolData, formatToolAskMessage } from "../../utils/tools.js"
import ChatHistoryItem from "../ChatHistoryItem.js"
import { getToolRenderer } from "../tools/index.js"
import { CommandTool } from "../tools/CommandTool.js"
import { CompletionTool } from "../tools/CompletionTool.js"
import { FileReadTool } from "../tools/FileReadTool.js"
import { FileWriteTool } from "../tools/FileWriteTool.js"
import { GenericTool } from "../tools/GenericTool.js"
import { ModeTool } from "../tools/ModeTool.js"
import { SearchTool } from "../tools/SearchTool.js"

/**
 * Parity of the CLI tool rows with the webview's (CLI-5 slice 1).
 *
 * One row per `tool` value the extension puts in a "tool" payload (the
 * ClineSayTool union, the legacy edit names the webview still renders, and
 * `runParallelTasks`, which is sent with no type). Each row says what the
 * webview row for that payload shows (its header values: path, query, URL,
 * mode, ...) and checks that the CLI row, built the way the transcript reducer
 * builds it for an auto-approved tool ask, shows the same thing under a real
 * title rather than the raw payload name.
 */

// apply_diff sends its SEARCH/REPLACE blocks in `diff` and the unified patch
// of the result in `content`; the webview shows `content ?? diff`.
const SEARCH_REPLACE = [
	"<<<<<<< SEARCH",
	":start_line:1",
	"-------",
	"search side line",
	"=======",
	"replace side line",
	">>>>>>> REPLACE",
].join("\n")
const UNIFIED = ["@@ -1,2 +1,2 @@", " kept line", "-old unified line", "+new unified line"].join("\n")

interface ParityRow {
	/** Test name when the tool name alone is ambiguous. */
	label?: string
	payload: Record<string, unknown>
	renderer: unknown
	/** Substrings the CLI row must show (what the webview row shows). */
	shows: string[]
	/** Substrings it must not show. */
	hides?: string[]
}

const rows: ParityRow[] = [
	// Edits: the webview's EditFileToolRow / InsertContentToolRow.
	{
		payload: { tool: "appliedDiff", path: "src/a.ts", diff: SEARCH_REPLACE, content: UNIFIED },
		renderer: FileWriteTool,
		shows: ["Edit(src/a.ts)", "new unified line"],
		hides: ["replace side line"],
	},
	{
		payload: { tool: "editedExistingFile", path: "src/a.ts", content: UNIFIED },
		renderer: FileWriteTool,
		shows: ["Edit(src/a.ts)", "new unified line"],
	},
	{
		payload: { tool: "newFileCreated", path: "src/new.ts", content: UNIFIED },
		renderer: FileWriteTool,
		shows: ["Create File(src/new.ts)", "new unified line"],
	},
	...[
		"searchAndReplace",
		"search_and_replace",
		"search_replace",
		"edit",
		"edit_file",
		"apply_patch",
		"apply_diff",
	].map(
		(tool): ParityRow => ({
			payload: { tool, path: "src/a.ts", diff: UNIFIED },
			renderer: FileWriteTool,
			shows: ["Edit(src/a.ts)", "new unified line"],
		}),
	),
	{
		payload: { tool: "insertContent", path: "src/a.ts", diff: UNIFIED, lineNumber: 3 },
		renderer: FileWriteTool,
		shows: ["Edit(src/a.ts)", "new unified line"],
	},

	// Reads and listings: ReadFileToolRow, ListFiles*ToolRow.
	{
		payload: { tool: "readFile", path: "src/a.ts", content: "/ws/src/a.ts" },
		renderer: FileReadTool,
		shows: ["Read(src/a.ts)"],
	},
	{
		label: "readFile (batch)",
		payload: {
			tool: "readFile",
			batchFiles: [
				{ path: "src/a.ts", lineSnippet: "", key: "src/a.ts", content: "/ws/src/a.ts" },
				{ path: "src/b.ts", lineSnippet: "lines 1-20", key: "src/b.ts (lines 1-20)", content: "/ws/src/b.ts" },
			],
		},
		renderer: FileReadTool,
		shows: ["Read (2 files)", "src/a.ts", "src/b.ts (lines 1-20)"],
	},
	{
		payload: { tool: "listFilesTopLevel", path: "src", content: "a.ts\nb.ts" },
		renderer: FileReadTool,
		shows: ["List(src)", "2 entries"],
	},
	{
		payload: { tool: "listFilesRecursive", path: "src", content: "a.ts\nlib/b.ts" },
		renderer: FileReadTool,
		shows: ["List(src)", "2 entries"],
	},

	// Searches: SearchFilesToolRow (path label `path/(filePattern)`),
	// CodebaseSearchToolRow (query and path), Web*ToolRow.
	{
		payload: {
			tool: "searchFiles",
			path: "src",
			regex: "TODO",
			filePattern: "*.ts",
			content: "src/a.ts:3:// TODO",
		},
		renderer: SearchTool,
		shows: ["Search(TODO)", "src/(*.ts)"],
	},
	{
		payload: { tool: "codebaseSearch", query: "auth flow", path: "src/auth" },
		renderer: SearchTool,
		shows: ["Search(auth flow)", "src/auth"],
	},
	{
		payload: { tool: "webSearch", queries: ["vitest mocks", "ink testing"], isOutsideWorkspace: false },
		renderer: GenericTool,
		shows: ["Web Search(vitest mocks, ink testing)"],
	},
	{
		payload: { tool: "webFetch", fetchedUrl: "https://example.com/docs", isOutsideWorkspace: false },
		renderer: GenericTool,
		shows: ["Web Fetch(https://example.com/docs)"],
	},

	// Modes and tasks: SwitchModeToolRow (mode and reason), NewTaskToolRow
	// (mode and message), FinishTaskToolRow, ReviewPlanToolRow (path).
	{
		payload: { tool: "switchMode", mode: "architect", reason: "plan first" },
		renderer: ModeTool,
		shows: ["Switch Mode(architect)", "plan first"],
	},
	{
		payload: { tool: "newTask", mode: "code", content: "Implement the parser" },
		renderer: GenericTool,
		shows: ["New Task(code)", "Implement the parser"],
		hides: ["Switch Mode"],
	},
	{
		payload: { tool: "finishTask" },
		renderer: GenericTool,
		shows: ["Finish Task"],
		hides: ["Switch Mode"],
	},
	{
		payload: { tool: "reviewPlan", path: "plans/p.md" },
		renderer: GenericTool,
		shows: ["Review Plan(plans/p.md)"],
	},

	// The rest: GenerateImageToolRow, RunSlashCommandToolRow, SkillToolRow,
	// ReadArtifactSayRow, SearchTaskHistorySayRow.
	{
		payload: { tool: "generateImage", path: "img/cat.png", content: "a cat on a mat" },
		renderer: GenericTool,
		shows: ["Generate Image(img/cat.png)", "a cat on a mat"],
	},
	{
		payload: {
			tool: "runSlashCommand",
			command: "deploy",
			args: "prod",
			source: "project",
			description: "Ship it",
		},
		renderer: GenericTool,
		shows: ["Slash Command(/deploy)"],
	},
	{
		payload: { tool: "skill", skill: "pdf-tools", args: "merge" },
		renderer: GenericTool,
		shows: ["Load Skill(pdf-tools)"],
	},
	{
		payload: { tool: "readArtifact", readStart: 0, readEnd: 1024, totalBytes: 4096 },
		renderer: GenericTool,
		shows: ["Read Artifact(0 B - 1.0 KB of 4.0 KB)"],
	},
	{
		label: "readArtifact (search)",
		payload: {
			tool: "readArtifact",
			readStart: 0,
			readEnd: 10,
			totalBytes: 4096,
			searchPattern: "error",
			matchCount: 2,
		},
		renderer: GenericTool,
		shows: ['Read Artifact(search: "error" • 2 matches)'],
	},
	{
		payload: { tool: "readCommandOutput", totalBytes: 2048 },
		renderer: GenericTool,
		shows: ["Read Command Output(2.0 KB)"],
	},
	{
		payload: { tool: "searchTaskHistory", query: "the port", totalBytes: 10 },
		renderer: GenericTool,
		shows: ["Search Task History(the port)"],
	},
	// No webview row renders this ask; the CLI at least names it.
	{
		payload: { tool: "runParallelTasks", count: 2, maxConcurrency: 2, subtasks: [] },
		renderer: GenericTool,
		shows: ["Run Parallel Tasks"],
	},
]

/** The row the transcript reducer adds for an auto-approved "tool" ask. */
function toolAskMessage(payload: Record<string, unknown>): TUIMessage {
	return {
		id: "1",
		role: "tool",
		content: formatToolAskMessage(payload),
		toolName: payload.tool as string,
		originalType: "tool",
		toolData: extractToolData(payload),
	}
}

describe("CLI tool rows show what the webview rows show", () => {
	it.each(rows.map((row) => [row.label ?? (row.payload.tool as string), row] as const))("%s", (_name, row) => {
		const message = toolAskMessage(row.payload)

		expect(getToolRenderer(message.toolData!.tool)).toBe(row.renderer)

		const frame = render(<ChatHistoryItem message={message} expanded />).lastFrame() ?? ""

		for (const text of row.shows) {
			expect(frame).toContain(text)
		}
		for (const text of row.hides ?? []) {
			expect(frame).not.toContain(text)
		}
	})
})

describe("rows the CLI builds itself keep their renderers", () => {
	it.each([
		["execute_command", CommandTool],
		["use_mcp_server", GenericTool],
		["attempt_completion", CompletionTool],
	] as const)("%s", (tool, renderer) => {
		expect(getToolRenderer(tool)).toBe(renderer)
	})
})
