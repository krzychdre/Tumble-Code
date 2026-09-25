import type { ClineSayTool } from "@roo-code/types"

/**
 * Tool payloads: the JSON object in the text of an `ask: "tool"` or a
 * `say: "tool"` message, `{ tool: "readFile", path: "src/a.ts", ... }`.
 *
 * The webview and the CLI both draw a row from it. This module is the part of
 * that work that is not drawing: which row family a payload name belongs to,
 * reading the fields with their types checked, and the few values a row shows
 * that are derived from more than one field (the diff to show, the header
 * value, the byte range of an artifact read). Each side keeps its rendering.
 */

/** The row family of a tool payload: payload names that render alike share one. */
export type ToolPayloadKind =
	| "edit"
	| "insert"
	| "readFile"
	| "listFiles"
	| "searchFiles"
	| "codebaseSearch"
	| "webSearch"
	| "webFetch"
	| "updateTodoList"
	| "switchMode"
	| "newTask"
	| "finishTask"
	| "reviewPlan"
	| "runSlashCommand"
	| "skill"
	| "generateImage"
	| "readArtifact"
	| "searchTaskHistory"
	| "runParallelTasks"

/** Every name of the ClineSayTool union: a name added there does not compile until it has a kind. */
const SAY_TOOL_KINDS: Record<ClineSayTool["tool"], ToolPayloadKind> = {
	editedExistingFile: "edit",
	appliedDiff: "edit",
	newFileCreated: "edit",
	codebaseSearch: "codebaseSearch",
	readFile: "readFile",
	readArtifact: "readArtifact",
	readCommandOutput: "readArtifact",
	listFilesTopLevel: "listFiles",
	listFilesRecursive: "listFiles",
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
}

/**
 * Names outside the union: the edit names older builds and other edit tools
 * sent (old task histories still carry them), the retired `listFiles`, and
 * `runParallelTasks`, which RunParallelTasksTool sends without the type.
 */
const OTHER_TOOL_KINDS: Record<string, ToolPayloadKind> = {
	searchAndReplace: "edit",
	search_and_replace: "edit",
	search_replace: "edit",
	edit: "edit",
	edit_file: "edit",
	apply_patch: "edit",
	apply_diff: "edit",
	insertContent: "insert",
	listFiles: "listFiles",
	runParallelTasks: "runParallelTasks",
}

/**
 * The kind of every payload name a tool message can carry. A Map, so a name
 * such as `constructor` or `__proto__` never finds an entry through the
 * prototype chain.
 */
export const TOOL_PAYLOAD_KINDS: ReadonlyMap<string, ToolPayloadKind> = new Map(
	Object.entries({ ...SAY_TOOL_KINDS, ...OTHER_TOOL_KINDS }),
)

/** The kind of a payload's `tool` value; undefined for a name no row knows. */
export function getToolPayloadKind(tool: unknown): ToolPayloadKind | undefined {
	return typeof tool === "string" ? TOOL_PAYLOAD_KINDS.get(tool) : undefined
}

/**
 * The payload in a message text, or undefined when the text is empty or is not
 * a JSON object (a streamed partial payload that does not parse yet, an array,
 * a bare string).
 */
export function parseToolPayloadText(text: string | null | undefined): Record<string, unknown> | undefined {
	if (!text) {
		return undefined
	}
	try {
		const value: unknown = JSON.parse(text)
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined
	} catch {
		return undefined
	}
}

/** One file of a batch read waiting for approval. */
export interface ToolPayloadBatchFile {
	path: string
	lineSnippet?: string
	isOutsideWorkspace?: boolean
	key?: string
	content?: string
}

/** One file of a batch of edits waiting for approval. */
export interface ToolPayloadBatchDiff {
	path: string
	changeCount?: number
	key?: string
	content?: string
	diffStats?: { added: number; removed: number }
	diffs?: Array<{ content: string; startLine?: number }>
}

/** A payload with its fields read and type-checked (a field of the wrong type is left out). */
export interface ToolPayload {
	/** The payload's `tool` value, `"unknown"` when it has none. */
	tool: string
	/** The row family; undefined for a name no row knows. */
	kind?: ToolPayloadKind
	/** The value a row puts next to its title (see `toolPayloadSubject`). */
	subject?: string

	path?: string
	isOutsideWorkspace?: boolean
	isProtected?: boolean
	content?: string
	reason?: string
	diff?: string
	diffStats?: { added: number; removed: number }

	regex?: string
	filePattern?: string
	query?: string
	queries?: string[]
	fetchedUrl?: string

	mode?: string
	command?: string
	args?: string
	source?: string
	description?: string
	skill?: string
	question?: string

	lineNumber?: number
	startLine?: number
	additionalFileCount?: number

	batchFiles?: ToolPayloadBatchFile[]
	batchDiffs?: ToolPayloadBatchDiff[]

	searchPattern?: string
	matchCount?: number
	readStart?: number
	readEnd?: number
	totalBytes?: number
}

type Fields = Record<string, unknown>

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const num = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined)
const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined)
const records = (value: unknown): Fields[] | undefined =>
	Array.isArray(value) ? value.filter((item): item is Fields => typeof item === "object" && item !== null) : undefined

function diffStatsOf(value: unknown): { added: number; removed: number } | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined
	}
	const { added, removed } = value as Fields
	return typeof added === "number" && typeof removed === "number" ? { added, removed } : undefined
}

/** Keeps only the keys whose value is defined, so a spread never overwrites with undefined. */
function defined<T extends object>(fields: T): Partial<T> {
	return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>
}

/**
 * Reads a parsed payload into a `ToolPayload`: every field type-checked, the
 * batch lists normalized, and `kind` and `subject` filled in.
 */
export function describeToolPayload(payload: Fields): ToolPayload {
	const tool = str(payload.tool) || "unknown"

	// A multi-file read is sent as `batchFiles` (ReadFileTool.requestApproval);
	// `files` is the name older builds used.
	const batchFiles = records(payload.batchFiles) ?? records(payload.files)
	const batchDiffs = records(payload.batchDiffs)
	const queries = Array.isArray(payload.queries)
		? payload.queries.filter((query): query is string => typeof query === "string")
		: undefined

	const described: ToolPayload = {
		tool,
		...defined({
			kind: getToolPayloadKind(tool),
			path: str(payload.path),
			isOutsideWorkspace: bool(payload.isOutsideWorkspace),
			isProtected: bool(payload.isProtected),
			content: str(payload.content),
			reason: str(payload.reason),
			diff: str(payload.diff),
			diffStats: diffStatsOf(payload.diffStats),
			regex: str(payload.regex),
			filePattern: str(payload.filePattern),
			query: str(payload.query),
			queries,
			fetchedUrl: str(payload.fetchedUrl),
			mode: str(payload.mode),
			command: str(payload.command),
			args: str(payload.args),
			source: str(payload.source),
			description: str(payload.description),
			skill: str(payload.skill),
			question: str(payload.question),
			lineNumber: num(payload.lineNumber),
			startLine: num(payload.startLine),
			additionalFileCount: num(payload.additionalFileCount),
			batchFiles: batchFiles?.map((file) => ({
				path: str(file.path) || "",
				...defined({
					lineSnippet: str(file.lineSnippet),
					isOutsideWorkspace: bool(file.isOutsideWorkspace),
					key: str(file.key),
					content: str(file.content),
				}),
			})),
			batchDiffs: batchDiffs?.map((file) => ({
				path: str(file.path) || "",
				...defined({
					changeCount: num(file.changeCount),
					key: str(file.key),
					content: str(file.content),
					diffStats: diffStatsOf(file.diffStats),
					diffs: records(file.diffs)?.map((hunk) => ({
						content: str(hunk.content) ?? "",
						...defined({ startLine: num(hunk.startLine) }),
					})),
				}),
			})),
			searchPattern: str(payload.searchPattern),
			matchCount: num(payload.matchCount),
			readStart: num(payload.readStart),
			readEnd: num(payload.readEnd),
			totalBytes: num(payload.totalBytes),
		}),
	}

	const subject = toolPayloadSubject(described)
	return subject === undefined ? described : { ...described, subject }
}

/**
 * The diff an edit row shows: the unified diff in `content` when the payload
 * has one, else `diff`. `apply_diff` sends its SEARCH/REPLACE blocks in `diff`
 * and, once applied, the unified patch of the result in `content`.
 */
export function toolPayloadDiffText(payload: { content?: string; diff?: string }): string | undefined {
	return payload.content ?? payload.diff
}

/** The queries of a web search, as one line. */
export function toolPayloadQueriesText(payload: { queries?: unknown }): string {
	return Array.isArray(payload.queries) ? payload.queries.join(", ") : ""
}

/**
 * Where a search looked: `path/(filePattern)` for a file search, the path for a
 * codebase search.
 */
export function toolPayloadSearchScope(payload: { path?: string; filePattern?: string }): string {
	return (payload.path ?? "") + (payload.filePattern ? `/(${payload.filePattern})` : "")
}

/** A byte count as `512 B`, `1.5 KB` or `2.0 MB`. */
export function formatToolPayloadBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * What an artifact read covered: `search: "pattern" • 2 matches` for a search,
 * `0 B - 1.0 KB of 4.0 KB` for a range, the size alone when that is all the
 * payload has, and an empty string when it has nothing.
 */
export function toolPayloadReadSummary(payload: {
	searchPattern?: string
	matchCount?: number
	readStart?: number
	readEnd?: number
	totalBytes?: number
}): string {
	if (payload.searchPattern !== undefined) {
		const matchText =
			payload.matchCount !== undefined
				? payload.matchCount === 1
					? "1 match"
					: `${payload.matchCount} matches`
				: ""
		return `search: "${payload.searchPattern}"${matchText ? ` • ${matchText}` : ""}`
	}
	if (payload.readStart !== undefined && payload.readEnd !== undefined && payload.totalBytes !== undefined) {
		return `${formatToolPayloadBytes(payload.readStart)} - ${formatToolPayloadBytes(payload.readEnd)} of ${formatToolPayloadBytes(payload.totalBytes)}`
	}
	if (payload.totalBytes !== undefined) {
		return formatToolPayloadBytes(payload.totalBytes)
	}
	return ""
}

/**
 * The value a row puts next to its title, the one the webview row's header
 * shows: the path of a file tool, the regex or query of a search, the URL of a
 * fetch, the mode of a mode switch or subtask, the name of a skill or slash
 * command, the range of an artifact read. Undefined when the row has none.
 */
export function toolPayloadSubject(payload: Omit<ToolPayload, "subject">): string | undefined {
	const nonEmpty = (value: string | undefined) => (value ? value : undefined)

	switch (payload.kind) {
		case "searchFiles":
			return nonEmpty(payload.regex)
		case "codebaseSearch":
		case "searchTaskHistory":
			return nonEmpty(payload.query)
		case "webSearch":
			return nonEmpty(toolPayloadQueriesText(payload))
		case "webFetch":
			return nonEmpty(payload.fetchedUrl)
		case "switchMode":
		case "newTask":
			return nonEmpty(payload.mode)
		case "skill":
			return nonEmpty(payload.skill)
		case "runSlashCommand":
			return payload.command ? `/${payload.command}` : undefined
		case "readArtifact":
			return nonEmpty(toolPayloadReadSummary(payload))
		case "finishTask":
		case "updateTodoList":
		case "runParallelTasks":
			return undefined
		default:
			// The file tools, and any name no row knows.
			return nonEmpty(payload.path)
	}
}
