import type { ToolRendererMap } from "../types"

import { EditFileToolRow, InsertContentToolRow } from "./EditFileToolRow"
import { CodebaseSearchToolRow, SearchFilesToolRow, WebFetchToolRow, WebSearchToolRow } from "./SearchToolRows"
import {
	GenerateImageToolRow,
	ListFilesRecursiveToolRow,
	ListFilesTopLevelToolRow,
	ReadFileToolRow,
} from "./FileToolRows"
import {
	FinishTaskToolRow,
	NewTaskToolRow,
	ReviewPlanToolRow,
	SwitchModeToolRow,
	UpdateTodoListToolRow,
} from "./TaskToolRows"
import { RunSlashCommandToolRow, SkillToolRow } from "./ExpandableToolRows"

/**
 * Renderers for a tool ask, by the payload's `tool`. A tool with no entry
 * renders nothing.
 */
export const TOOL_RENDERERS: ToolRendererMap = {
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
}
