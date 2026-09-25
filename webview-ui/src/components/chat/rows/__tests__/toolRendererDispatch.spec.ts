import { getToolPayloadKind } from "@roo-code/core/browser"

import { TOOL_RENDERERS } from "../renderers/tool"
import { EditFileToolRow, InsertContentToolRow } from "../renderers/tool/EditFileToolRow"
import {
	GenerateImageToolRow,
	ListFilesRecursiveToolRow,
	ListFilesTopLevelToolRow,
	ReadFileToolRow,
} from "../renderers/tool/FileToolRows"
import {
	CodebaseSearchToolRow,
	SearchFilesToolRow,
	WebFetchToolRow,
	WebSearchToolRow,
} from "../renderers/tool/SearchToolRows"
import {
	FinishTaskToolRow,
	NewTaskToolRow,
	ReviewPlanToolRow,
	SwitchModeToolRow,
	UpdateTodoListToolRow,
} from "../renderers/tool/TaskToolRows"
import { RunSlashCommandToolRow, SkillToolRow } from "../renderers/tool/ExpandableToolRows"
import { ReadArtifactSayRow, SAY_TOOL_RENDERERS, SearchTaskHistorySayRow } from "../renderers/say/SayToolRows"

// Which row a tool payload renders as, by its `tool` value (CLI-5 slice 1
// pins this before the tool names move into the shared payload table in
// @roo-code/core, so the move cannot change a row).

describe("tool ask rows by payload tool name", () => {
	it("renders exactly these names", () => {
		expect(TOOL_RENDERERS).toEqual({
			editedExistingFile: EditFileToolRow,
			appliedDiff: EditFileToolRow,
			newFileCreated: EditFileToolRow,
			searchAndReplace: EditFileToolRow,
			search_and_replace: EditFileToolRow,
			search_replace: EditFileToolRow,
			edit: EditFileToolRow,
			edit_file: EditFileToolRow,
			apply_patch: EditFileToolRow,
			apply_diff: EditFileToolRow,
			insertContent: InsertContentToolRow,
			codebaseSearch: CodebaseSearchToolRow,
			webSearch: WebSearchToolRow,
			webFetch: WebFetchToolRow,
			updateTodoList: UpdateTodoListToolRow,
			readFile: ReadFileToolRow,
			skill: SkillToolRow,
			listFilesTopLevel: ListFilesTopLevelToolRow,
			listFilesRecursive: ListFilesRecursiveToolRow,
			searchFiles: SearchFilesToolRow,
			switchMode: SwitchModeToolRow,
			newTask: NewTaskToolRow,
			finishTask: FinishTaskToolRow,
			reviewPlan: ReviewPlanToolRow,
			runSlashCommand: RunSlashCommandToolRow,
			generateImage: GenerateImageToolRow,
		})
	})

	it("renders nothing for a name it does not know", () => {
		// Sent by the extension, but no row renders it (yet).
		expect(TOOL_RENDERERS["runParallelTasks" as keyof typeof TOOL_RENDERERS]).toBeUndefined()
		// Never looked up through the prototype chain.
		expect(Object.hasOwn(TOOL_RENDERERS, "constructor")).toBe(false)
	})
})

describe("say tool rows by payload tool name", () => {
	it("renders exactly these names", () => {
		expect(SAY_TOOL_RENDERERS).toEqual({
			runSlashCommand: RunSlashCommandToolRow,
			searchTaskHistory: SearchTaskHistorySayRow,
			readArtifact: ReadArtifactSayRow,
			readCommandOutput: ReadArtifactSayRow,
		})
	})
})

describe("the shared payload kinds (@roo-code/core)", () => {
	it.each([
		["tool ask", TOOL_RENDERERS],
		["say tool", SAY_TOOL_RENDERERS],
	] as const)("give every %s row name a kind, and names of one kind the same row", (_label, renderers) => {
		const rowByKind = new Map<string, unknown>()
		for (const [name, renderer] of Object.entries(renderers)) {
			const kind = getToolPayloadKind(name)
			expect([name, kind !== undefined]).toEqual([name, true])
			// The two list rows differ only in their title, so they share a kind.
			if (kind === "listFiles") {
				continue
			}
			if (!rowByKind.has(kind!)) {
				rowByKind.set(kind!, renderer)
			}
			expect([name, rowByKind.get(kind!) === renderer]).toEqual([name, true])
		}
	})
})
