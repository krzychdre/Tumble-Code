import type { ClineMessage } from "@roo-code/types"

import { batchConsecutive } from "@src/utils/batchConsecutive"

import { parseToolCached, type ParsedTool } from "./parseToolCached"

// File-editing tools whose consecutive asks become one BatchDiffApproval row.
const EDIT_FILE_TOOLS: ReadonlySet<string> = new Set([
	"editedExistingFile",
	"appliedDiff",
	"newFileCreated",
	"insertContent",
	"searchAndReplace",
])

// Rows this module synthesized. Their payload is already a batch, which every
// predicate below rejects; skipping the parse also keeps the parse cache entry
// of the batch's first message (same ts, different text) from being replaced.
const synthesizedRowObjects = new WeakSet<ClineMessage>()

const toolAsk = (message: ClineMessage): ParsedTool | undefined =>
	message.type === "ask" && message.ask === "tool" && !synthesizedRowObjects.has(message)
		? parseToolCached(message)
		: undefined

// Each predicate skips payloads that are already a batch, so a synthesized row
// is never batched again.
const isReadFileAsk = (message: ClineMessage): boolean => {
	const tool = toolAsk(message)
	return tool?.tool === "readFile" && !tool.batchFiles
}

const isListFilesAsk = (message: ClineMessage): boolean => {
	const tool = toolAsk(message)
	return (tool?.tool === "listFilesTopLevel" || tool?.tool === "listFilesRecursive") && !tool.batchDirs
}

const isEditFileAsk = (message: ClineMessage): boolean => {
	const tool = toolAsk(message)
	return tool !== undefined && EDIT_FILE_TOOLS.has(tool.tool as string) && !tool.batchDiffs
}

// Every message of a batch passed its predicate, so its payload parses.
const payloadOf = (message: ClineMessage): ParsedTool => toolAsk(message) ?? {}

type BatchField = "batchFiles" | "batchDirs" | "batchDiffs"

// Synthetic rows by the first message of their batch. The row is rebuilt only
// when a member's text changes or the first message is replaced (a new object
// from the host); otherwise the same row object comes back, so re-deriving the
// list on every streamed token does not re-serialize every batch, and the
// row's memo sees an identical message. A WeakMap: entries go with the history.
const synthesizedRows = new WeakMap<
	ClineMessage,
	{ field: BatchField; texts: (string | undefined)[]; row: ClineMessage }
>()

const synthesize =
	(field: BatchField, entry: (tool: ParsedTool) => unknown) =>
	(batch: ClineMessage[]): ClineMessage => {
		const [first] = batch
		const hit = synthesizedRows.get(first)
		if (
			hit !== undefined &&
			hit.field === field &&
			hit.texts.length === batch.length &&
			hit.texts.every((text, i) => text === batch[i].text)
		) {
			return hit.row
		}
		const row = {
			...first,
			text: JSON.stringify({ ...payloadOf(first), [field]: batch.map((message) => entry(payloadOf(message))) }),
		}
		synthesizedRows.set(first, { field, texts: batch.map((message) => message.text), row })
		synthesizedRowObjects.add(row)
		return row
	}

const synthesizeReadFileBatch = synthesize("batchFiles", (tool) => ({
	path: tool.path || "",
	lineSnippet: tool.reason || "",
	isOutsideWorkspace: tool.isOutsideWorkspace || false,
	key: `${tool.path}${tool.reason ? ` (${tool.reason})` : ""}`,
	content: tool.content || "",
}))

const synthesizeListFilesBatch = synthesize("batchDirs", (tool) => ({
	path: tool.path || "",
	recursive: tool.tool === "listFilesRecursive",
	isOutsideWorkspace: tool.isOutsideWorkspace || false,
	key: tool.path || "",
}))

const synthesizeEditFileBatch = synthesize("batchDiffs", (tool) => ({
	path: tool.path || "",
	changeCount: 1,
	key: tool.path || "",
	content: tool.content || tool.diff || "",
	diffStats: tool.diffStats,
}))

/**
 * Replace each run of consecutive read_file, list_files and file-edit asks by
 * one synthetic row whose payload carries `batchFiles`, `batchDirs` or
 * `batchDiffs`. A run of one ask stays as it is. Returns a new array; the input
 * rows are not modified.
 */
export function groupToolAsks(rows: readonly ClineMessage[]): ClineMessage[] {
	const readFileBatched = batchConsecutive([...rows], isReadFileAsk, synthesizeReadFileBatch)
	const listFilesBatched = batchConsecutive(readFileBatched, isListFilesAsk, synthesizeListFilesBatch)
	return batchConsecutive(listFilesBatched, isEditFileAsk, synthesizeEditFileBatch)
}
