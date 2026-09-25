import type { FileEntry } from "@roo-code/types"

/**
 * Per-tool argument parsing for native tool calls (CORE-R4 part c).
 *
 * Each function turns the JSON arguments a model sent into the typed `nativeArgs` a tool
 * executes with. The same function serves both parser paths of NativeToolCallParser:
 * - `partial: true`: the arguments are still streaming (parsed with partial-json), and the
 *   result only feeds the progress UI, so most tools build `nativeArgs` as soon as any of
 *   their fields has arrived;
 * - `partial: false`: the call is complete; a tool returns no `nativeArgs` when a required
 *   field is missing, and the parser then rejects the call.
 *
 * Many tolerances below exist for weak models (GLM, Qwen, local Llamas): numbers and
 * booleans sent as strings, the legacy read_file `files` array (also double-stringified),
 * a bare string instead of an array. Keep every one of them.
 *
 * The functions only reshape plain data: no VS Code, no Task, no tool classes, so the
 * descriptor table can hold them without pulling heavy imports into its readers.
 */

export interface ToolArgParseOptions {
	/** The arguments are still streaming. */
	partial: boolean
}

export interface ParsedToolArgs {
	nativeArgs: unknown
	/** The call used the legacy read_file `files` shape (reported to telemetry). */
	usedLegacyFormat?: true
}

/** Returns undefined when the arguments do not yield `nativeArgs` (yet). */
export type ToolArgParser = (raw: Record<string, any>, options: ToolArgParseOptions) => ParsedToolArgs | undefined

function coerceOptionalBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") {
		return value
	}
	if (typeof value === "string") {
		const lower = value.trim().toLowerCase()
		if (lower === "true") {
			return true
		}
		if (lower === "false") {
			return false
		}
	}
	return undefined
}

function coerceOptionalNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value
	}
	if (typeof value === "string") {
		const n = Number(value)
		if (Number.isFinite(n)) {
			return n
		}
	}
	return undefined
}

function built(nativeArgs: object): ParsedToolArgs {
	return { nativeArgs }
}

/**
 * The gate most tools use: while streaming, any of the fields is enough to show progress;
 * a complete call needs all of them.
 */
function hasFields(raw: Record<string, any>, fields: string[], partial: boolean): boolean {
	return partial
		? fields.some((field) => raw[field] !== undefined)
		: fields.every((field) => raw[field] !== undefined)
}

/**
 * Convert raw file entries from the API (with line_ranges) to FileEntry objects (with
 * lineRanges). Accepted range shapes, for backward compatibility:
 * - tuple: `{ path, line_ranges: [[1, 50], [100, 150]] }`
 * - object: `{ path, line_ranges: [{ start: 1, end: 50 }] }`
 * - legacy string: `{ path, line_ranges: ["1-50"] }`
 */
function convertFileEntries(files: unknown[]): FileEntry[] {
	return files.map((file: unknown) => {
		const f = file as Record<string, unknown>
		const entry: FileEntry = { path: f.path as string }
		if (f.line_ranges && Array.isArray(f.line_ranges)) {
			entry.lineRanges = (f.line_ranges as unknown[])
				.map((range: unknown) => {
					if (Array.isArray(range) && range.length >= 2) {
						return { start: Number(range[0]), end: Number(range[1]) }
					}
					if (typeof range === "object" && range !== null && "start" in range && "end" in range) {
						const r = range as { start: unknown; end: unknown }
						return { start: Number(r.start), end: Number(r.end) }
					}
					if (typeof range === "string") {
						const match = range.match(/^(\d+)-(\d+)$/)
						if (match) {
							return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) }
						}
					}
					return null
				})
				.filter((r): r is { start: number; end: number } => r !== null)
		}
		return entry
	})
}

/** read_file: the same coercion while streaming and when complete. */
export const parseReadFileArgs: ToolArgParser = (raw) => {
	// Legacy format first: { files: [...] }, also double-stringified by some models.
	if (raw.files !== undefined) {
		let filesArray: unknown[] | null = null

		if (Array.isArray(raw.files)) {
			filesArray = raw.files
		} else if (typeof raw.files === "string") {
			try {
				const parsed = JSON.parse(raw.files)
				if (Array.isArray(parsed)) {
					filesArray = parsed
				}
			} catch {
				// Not valid JSON, ignore.
			}
		}

		if (filesArray && filesArray.length > 0) {
			return {
				nativeArgs: { files: convertFileEntries(filesArray), _legacyFormat: true as const },
				usedLegacyFormat: true,
			}
		}
	}

	// New format: { path, mode, offset, limit, indentation }.
	if (raw.path === undefined) {
		return undefined
	}

	return {
		nativeArgs: {
			path: raw.path,
			mode: raw.mode,
			offset: coerceOptionalNumber(raw.offset),
			limit: coerceOptionalNumber(raw.limit),
			indentation:
				raw.indentation && typeof raw.indentation === "object"
					? {
							anchor_line: coerceOptionalNumber(raw.indentation.anchor_line),
							max_levels: coerceOptionalNumber(raw.indentation.max_levels),
							max_lines: coerceOptionalNumber(raw.indentation.max_lines),
							include_siblings: coerceOptionalBoolean(raw.indentation.include_siblings),
							include_header: coerceOptionalBoolean(raw.indentation.include_header),
						}
					: undefined,
		},
	}
}

/** read_artifact and its legacy name read_command_output. No partial arguments (the progress UI reads params). */
export const parseReadArtifactArgs: ToolArgParser = (raw, { partial }) =>
	!partial && raw.artifact_id !== undefined
		? built({ artifact_id: raw.artifact_id, search: raw.search, offset: raw.offset, limit: raw.limit })
		: undefined

export const parseAttemptCompletionArgs: ToolArgParser = (raw) =>
	raw.result ? built({ result: raw.result }) : undefined

export const parseExecuteCommandArgs: ToolArgParser = (raw) =>
	raw.command ? built({ command: raw.command, cwd: raw.cwd, timeout: raw.timeout }) : undefined

export const parseWriteToFileArgs: ToolArgParser = (raw, { partial }) => {
	// Streaming checks truthiness, not presence: an empty path and content show nothing yet.
	const ready = partial ? raw.path || raw.content : raw.path !== undefined && raw.content !== undefined
	return ready ? built({ path: raw.path, content: raw.content }) : undefined
}

export const parseAskFollowupQuestionArgs: ToolArgParser = (raw, { partial }) => {
	if (partial) {
		return raw.question !== undefined || raw.follow_up !== undefined
			? built({
					question: raw.question,
					follow_up: Array.isArray(raw.follow_up) ? raw.follow_up : undefined,
				})
			: undefined
	}
	// A present follow_up that is not an array is forwarded raw so the tool can answer with
	// a precise "must be an array" error instead of the generic missing-parameter one.
	return raw.question !== undefined && raw.follow_up !== undefined
		? built({ question: raw.question, follow_up: raw.follow_up })
		: undefined
}

export const parseApplyDiffArgs: ToolArgParser = (raw, { partial }) =>
	hasFields(raw, ["path", "diff"], partial) ? built({ path: raw.path, diff: raw.diff }) : undefined

export const parseCodebaseSearchArgs: ToolArgParser = (raw) =>
	raw.query !== undefined ? built({ query: raw.query, path: raw.path }) : undefined

export const parseGenerateImageArgs: ToolArgParser = (raw, { partial }) =>
	hasFields(raw, ["prompt", "path"], partial)
		? built({ prompt: raw.prompt, path: raw.path, image: raw.image })
		: undefined

export const parseRunSlashCommandArgs: ToolArgParser = (raw) =>
	raw.command !== undefined ? built({ command: raw.command, args: raw.args }) : undefined

export const parseSkillArgs: ToolArgParser = (raw) =>
	raw.skill !== undefined ? built({ skill: raw.skill, args: raw.args }) : undefined

export const parseSearchFilesArgs: ToolArgParser = (raw, { partial }) =>
	hasFields(raw, ["path", "regex"], partial)
		? built({ path: raw.path, regex: raw.regex, file_pattern: raw.file_pattern })
		: undefined

export const parseSwitchModeArgs: ToolArgParser = (raw, { partial }) =>
	hasFields(raw, ["mode_slug", "reason"], partial)
		? built({ mode_slug: raw.mode_slug, reason: raw.reason })
		: undefined

export const parseUpdateTodoListArgs: ToolArgParser = (raw) =>
	raw.todos !== undefined ? built({ todos: raw.todos }) : undefined

export const parseUseMcpToolArgs: ToolArgParser = (raw, { partial }) =>
	hasFields(raw, ["server_name", "tool_name"], partial)
		? built({ server_name: raw.server_name, tool_name: raw.tool_name, arguments: raw.arguments })
		: undefined

/** No partial arguments (the progress UI reads params). */
export const parseAccessMcpResourceArgs: ToolArgParser = (raw, { partial }) =>
	!partial && raw.server_name !== undefined && raw.uri !== undefined
		? built({ server_name: raw.server_name, uri: raw.uri })
		: undefined

export const parseApplyPatchArgs: ToolArgParser = (raw) =>
	raw.patch !== undefined ? built({ patch: raw.patch }) : undefined

const EDIT_FIELDS = ["file_path", "old_string", "new_string"]

export const parseSearchReplaceArgs: ToolArgParser = (raw, { partial }) =>
	hasFields(raw, EDIT_FIELDS, partial)
		? built({ file_path: raw.file_path, old_string: raw.old_string, new_string: raw.new_string })
		: undefined

/** edit and its alias search_and_replace. */
export const parseEditArgs: ToolArgParser = (raw, { partial }) =>
	hasFields(raw, EDIT_FIELDS, partial)
		? built({
				file_path: raw.file_path,
				old_string: raw.old_string,
				new_string: raw.new_string,
				replace_all: coerceOptionalBoolean(raw.replace_all),
			})
		: undefined

export const parseEditFileArgs: ToolArgParser = (raw, { partial }) =>
	hasFields(raw, EDIT_FIELDS, partial)
		? built({
				file_path: raw.file_path,
				old_string: raw.old_string,
				new_string: raw.new_string,
				expected_replacements: raw.expected_replacements,
			})
		: undefined

export const parseListFilesArgs: ToolArgParser = (raw) =>
	raw.path !== undefined ? built({ path: raw.path, recursive: coerceOptionalBoolean(raw.recursive) }) : undefined

export const parseNewTaskArgs: ToolArgParser = (raw, { partial }) =>
	hasFields(raw, ["mode", "message"], partial)
		? built({ mode: raw.mode, message: raw.message, todos: raw.todos })
		: undefined

export const parseRunParallelTasksArgs: ToolArgParser = (raw, { partial }) => {
	if (partial) {
		return raw.subtasks !== undefined
			? built({
					subtasks: Array.isArray(raw.subtasks) ? raw.subtasks : [],
					maxConcurrency: raw.maxConcurrency ?? null,
				})
			: undefined
	}
	return Array.isArray(raw.subtasks)
		? built({ subtasks: raw.subtasks, maxConcurrency: raw.maxConcurrency ?? null })
		: undefined
}

/** A complete call always parses (an empty list gets guidance from the tool); streaming waits for `names`. */
export const parseToolsLoadArgs: ToolArgParser = (raw, { partial }) =>
	partial && raw.names === undefined
		? undefined
		: built({
				names: Array.isArray(raw.names)
					? raw.names.filter((n: unknown): n is string => typeof n === "string")
					: [],
			})

/** A bare string is accepted because weak models routinely send one instead of an array. */
export const parseWebSearchArgs: ToolArgParser = (raw, { partial }) => {
	if (partial) {
		if (typeof raw.queries === "string") {
			return built({ queries: [raw.queries] })
		}
		return raw.queries !== undefined
			? built({
					queries: Array.isArray(raw.queries)
						? raw.queries.filter((q: unknown): q is string => typeof q === "string")
						: [],
				})
			: undefined
	}
	if (typeof raw.queries === "string" && raw.queries.trim()) {
		return built({ queries: [raw.queries] })
	}
	return Array.isArray(raw.queries)
		? built({ queries: raw.queries.filter((query: unknown) => typeof query === "string") })
		: undefined
}

export const parseWebFetchArgs: ToolArgParser = (raw) => (raw.url !== undefined ? built({ url: raw.url }) : undefined)

/** Weak models send "20" as often as 20; coerce so a string does not silently fall back to the default. */
export const parseSearchTaskHistoryArgs: ToolArgParser = (raw) =>
	raw.query !== undefined
		? built({ query: raw.query, max_results: coerceOptionalNumber(raw.max_results) })
		: undefined
