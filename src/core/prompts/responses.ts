import { Anthropic } from "@anthropic-ai/sdk"
import * as path from "path"
import * as diff from "diff"
import { RooIgnoreController, LOCK_TEXT_SYMBOL } from "../ignore/RooIgnoreController"
import { RooProtectedController } from "../protect/RooProtectedController"
import { getToolMinimalExample } from "./tools/native-tools/examples"

// Opens every empty-response retry note, so a later retry can find and replace the
// previous one instead of stacking a second note.
const EMPTY_RESPONSE_RETRY_NOTE_START =
	"[ERROR] Your previous reply produced no text and no tool call that reached the system."

export const formatResponse = {
	toolDenied: () =>
		JSON.stringify({
			status: "denied",
			message: "The user denied this operation.",
		}),

	toolDeniedWithFeedback: (feedback?: string) =>
		JSON.stringify({
			status: "denied",
			feedback,
		}),

	toolApprovedWithFeedback: (feedback?: string) =>
		JSON.stringify({
			status: "approved",
			feedback,
		}),

	/**
	 * @param toolName Tool the failed call was addressed to. When it is a statically
	 * advertised tool, its minimal valid invocation rides along as a nested JSON object
	 * under `minimal_valid_example`, so a weak model can copy it verbatim and retry.
	 *
	 * The example must never be embedded in `error` (or in an `Error.message` that ends
	 * up there): `error` is a string field inside this envelope, so anything placed in it
	 * is escaped a second time and stops being copyable.
	 */
	toolError: (error?: string, toolName?: string) => {
		const example = getToolMinimalExample(toolName)

		return JSON.stringify({
			status: "error",
			message: "The tool execution failed",
			error,
			...(example ? { failed_tool: toolName, minimal_valid_example: example } : {}),
		})
	},

	rooIgnoreError: (path: string) =>
		JSON.stringify({
			status: "error",
			type: "access_denied",
			message: "Access blocked by .rooignore",
			path,
			suggestion: "Try to continue without this file, or ask the user to update the .rooignore file",
		}),

	noToolsUsed: () => {
		const instructions = getToolInstructionsReminder()

		return `[ERROR] You did not use a tool in your previous response! Please retry with a tool use.

${instructions}

# Next Steps

If you have completed the user's task, use the attempt_completion tool.
If you require additional information from the user, use the ask_followup_question tool.
Otherwise, if you have not completed the task and do not need additional information, then proceed with the next step of the task.
(This is an automated message, so do not respond to it conversationally.)`
	},

	/**
	 * Appended to the user content when an empty answer (no text, no tool call) is retried.
	 * A server such as vLLM drops a call to a tool that is not in the request's tool list
	 * without an error, so the model never learns why its turn vanished and a blind retry
	 * repeats the same call. The note names the tools it can call instead.
	 *
	 * @param toolNames The callable tool names of the request that came back empty, or
	 * `undefined` when they are no longer current (the task switched mode since).
	 */
	emptyResponseRetryNote: (toolNames: string[] | undefined) => {
		const tools = !toolNames
			? "Use only the tools in your tool list, or reply with plain text."
			: toolNames.length > 0
				? `The tools you can call now are: ${toolNames.join(", ")}.\nReply with one of these tools, or with plain text.`
				: "You have no tools in this request. Reply with plain text."

		return `${EMPTY_RESPONSE_RETRY_NOTE_START}
A call to a tool that is not in your tool list is rejected by the server and discarded.
${tools}`
	},

	isEmptyResponseRetryNote: (text: string) => text.startsWith(EMPTY_RESPONSE_RETRY_NOTE_START),

	/**
	 * @param toolName Tool whose failure grew the mistake counter, or `undefined` when the
	 * counter grew because no tool was called at all. Only pass a name in the first case:
	 * on a no-tool-used turn an example would invite a pointless re-call of a tool that
	 * had actually succeeded.
	 */
	tooManyMistakes: (feedback?: string, toolName?: string) => {
		const example = getToolMinimalExample(toolName)

		return JSON.stringify({
			status: "guidance",
			feedback,
			...(example ? { failed_tool: toolName, minimal_valid_example: example } : {}),
		})
	},

	/**
	 * Plain text, wrapped by the caller in `toolError`, which is where the minimal example
	 * is attached as a structured field. Keeping it out of this string is what prevents the
	 * example from being escaped twice.
	 */
	missingToolParameterError: (paramName: string) => {
		const instructions = getToolInstructionsReminder()

		return `Missing value for required parameter '${paramName}'. Please retry with complete response.\n\n${instructions}`
	},

	invalidMcpToolArgumentError: (serverName: string, toolName: string) =>
		JSON.stringify({
			status: "error",
			type: "invalid_argument",
			message: "Invalid JSON argument",
			server: serverName,
			tool: toolName,
			suggestion: "Please retry with a properly formatted JSON argument",
		}),

	unknownMcpToolError: (serverName: string, toolName: string, availableTools: string[]) =>
		JSON.stringify({
			status: "error",
			type: "unknown_tool",
			message: "Tool does not exist on server",
			server: serverName,
			tool: toolName,
			available_tools: availableTools.length > 0 ? availableTools : [],
			suggestion: "Please use one of the available tools or check if the server is properly configured",
		}),

	unknownMcpServerError: (serverName: string, availableServers: string[]) =>
		JSON.stringify({
			status: "error",
			type: "unknown_server",
			message: "Server is not configured",
			server: serverName,
			available_servers: availableServers.length > 0 ? availableServers : [],
		}),

	toolResult: (
		text: string,
		images?: string[],
	): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> => {
		if (images && images.length > 0) {
			const textBlock: Anthropic.TextBlockParam = { type: "text", text }
			const imageBlocks: Anthropic.ImageBlockParam[] = formatImagesIntoBlocks(images)
			// Placing images after text leads to better results
			return [textBlock, ...imageBlocks]
		} else {
			return text
		}
	},

	imageBlocks: (images?: string[]): Anthropic.ImageBlockParam[] => {
		return formatImagesIntoBlocks(images)
	},

	formatFilesList: (
		absolutePath: string,
		files: string[],
		didHitLimit: boolean,
		rooIgnoreController: RooIgnoreController | undefined,
		showRooIgnoredFiles: boolean,
		rooProtectedController?: RooProtectedController,
	): string => {
		const sorted = files
			.map((file) => {
				// convert absolute path to relative path
				const relativePath = path.relative(absolutePath, file).toPosix()
				return file.endsWith("/") ? relativePath + "/" : relativePath
			})
			// Sort so files are listed under their respective directories to make it clear what files are children of what directories. Since we build file list top down, even if file list is truncated it will show directories that cline can then explore further.
			.sort((a, b) => {
				const aParts = a.split("/") // only works if we use toPosix first
				const bParts = b.split("/")
				for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
					if (aParts[i] !== bParts[i]) {
						// If one is a directory and the other isn't at this level, sort the directory first
						if (i + 1 === aParts.length && i + 1 < bParts.length) {
							return -1
						}
						if (i + 1 === bParts.length && i + 1 < aParts.length) {
							return 1
						}
						// Otherwise, sort alphabetically
						return aParts[i].localeCompare(bParts[i], undefined, { numeric: true, sensitivity: "base" })
					}
				}
				// If all parts are the same up to the length of the shorter path,
				// the shorter one comes first
				return aParts.length - bParts.length
			})

		let rooIgnoreParsed: string[] = sorted

		if (rooIgnoreController) {
			rooIgnoreParsed = []
			for (const filePath of sorted) {
				// path is relative to absolute path, not cwd
				// validateAccess expects either path relative to cwd or absolute path
				// otherwise, for validating against ignore patterns like "assets/icons", we would end up with just "icons", which would result in the path not being ignored.
				const absoluteFilePath = path.resolve(absolutePath, filePath)
				const isIgnored = !rooIgnoreController.validateAccess(absoluteFilePath)

				if (isIgnored) {
					// If file is ignored and we're not showing ignored files, skip it
					if (!showRooIgnoredFiles) {
						continue
					}
					// Otherwise, mark it with a lock symbol
					rooIgnoreParsed.push(LOCK_TEXT_SYMBOL + " " + filePath)
				} else {
					// Check if file is write-protected (only for non-ignored files)
					const isWriteProtected = rooProtectedController?.isWriteProtected(absoluteFilePath) || false
					if (isWriteProtected) {
						rooIgnoreParsed.push("🛡️ " + filePath)
					} else {
						rooIgnoreParsed.push(filePath)
					}
				}
			}
		}
		if (didHitLimit) {
			return `${rooIgnoreParsed.join(
				"\n",
			)}\n\n(File list truncated. Use list_files on specific subdirectories if you need to explore further.)`
		} else if (rooIgnoreParsed.length === 0 || (rooIgnoreParsed.length === 1 && rooIgnoreParsed[0] === "")) {
			return "No files found."
		} else {
			return rooIgnoreParsed.join("\n")
		}
	},

	createPrettyPatch: (filename = "file", oldStr?: string, newStr?: string) => {
		// strings cannot be undefined or diff throws exception
		const patch = diff.createPatch(filename.toPosix(), oldStr || "", newStr || "", undefined, undefined, {
			context: 3,
		})
		const lines = patch.split("\n")
		const prettyPatchLines = lines.slice(4)
		return prettyPatchLines.join("\n")
	},
}

/** Most lines of the file quoted in a compact edit error. */
const COMPACT_QUOTE_MAX_LINES = 6
/** Most characters of the file quoted in a compact edit error. */
const COMPACT_QUOTE_MAX_CHARS = 400
/** Most characters of a file line used as the old_string of an example call. */
const COMPACT_EXAMPLE_LINE_MAX_CHARS = 120

/** The leading lines that fit the quote budget (at least one, cut when it alone is too long). */
function compactQuote(lines: string[]): string[] {
	const shown: string[] = []
	let chars = 0
	for (const line of lines.slice(0, COMPACT_QUOTE_MAX_LINES)) {
		if (shown.length > 0 && chars + line.length + 1 > COMPACT_QUOTE_MAX_CHARS) {
			break
		}
		shown.push(line.length > COMPACT_QUOTE_MAX_CHARS ? line.slice(0, COMPACT_QUOTE_MAX_CHARS) : line)
		chars += line.length + 1
	}
	return shown
}

function compactExample(toolName: string, args: Record<string, unknown>): string {
	return `Example ${toolName} call: ${JSON.stringify(args)}`
}

/** The minimal example of a tool with its path argument set to the file the model is working on. */
function compactMinimalExample(toolName: string, overrides: Record<string, unknown>): string {
	return compactExample(toolName, { ...getToolMinimalExample(toolName), ...overrides })
}

/**
 * Tool results for the compact profile (`isCompactProfile`, small local models). Plain
 * text, short, starting with `Error:` (which the context ledger classifies as an error),
 * with one example call written as the JSON arguments the model sends. The JSON envelope
 * of `formatResponse.toolError` would escape the quoted file text a second time, and a
 * small model cannot copy text back out of that. `formatResponse` is not used for compact
 * results, so every result without the flag stays as it was.
 */
export const compactResponses = {
	missingParameter: (toolName: string, paramName: string) =>
		`Error: Missing parameter '${paramName}'.\n${compactMinimalExample(toolName, {})}`,

	editFileNotFound: (relPath: string) =>
		`Error: ${relPath} does not exist. Check the path with list_files, or create the file with write_to_file.\n${compactMinimalExample("write_to_file", { path: relPath })}`,

	editReadFailed: (relPath: string, reason: string) => `Error: Could not read ${relPath}: ${reason}`,

	editIdenticalStrings: (relPath: string) =>
		`Error: old_string and new_string are identical, so nothing would change. Put the changed text in new_string.\n${compactMinimalExample("edit", { file_path: relPath })}`,

	editEmptyNewString: (relPath: string) =>
		`Error: old_string and new_string are both empty, so there is nothing to write to ${relPath}.\n${compactMinimalExample("write_to_file", { path: relPath })}`,

	/**
	 * old_string was not found. Quotes the closest window of the file as raw text and builds
	 * the example from its line most like old_string.
	 */
	editNoMatch: (relPath: string, snippet: { startLine: number; lines: string[]; bestLine: number } | undefined) => {
		if (!snippet) {
			return `Error: old_string was not found in ${relPath}, which is empty. Write its content with write_to_file.\n${compactMinimalExample("write_to_file", { path: relPath })}`
		}
		const quoted = compactQuote(snippet.lines)
		const endLine = snippet.startLine + quoted.length - 1
		const range = quoted.length > 1 ? `lines ${snippet.startLine}-${endLine}` : `line ${snippet.startLine}`
		const exampleLine = (quoted[Math.min(snippet.bestLine, quoted.length - 1)] ?? "").slice(
			0,
			COMPACT_EXAMPLE_LINE_MAX_CHARS,
		)
		return [
			`Error: old_string was not found in ${relPath}. The closest text in the file (${range}) is:`,
			...quoted,
			"Copy old_string exactly from the file text, without line numbers.",
			// An empty old_string means "create or append" under compact, so never suggest one.
			...(exampleLine.trim() === ""
				? []
				: [compactExample("edit", { file_path: relPath, old_string: exampleLine, new_string: "<new text>" })]),
		].join("\n")
	},

	/**
	 * old_string matched several places and replace_all is off.
	 *
	 * @param startLines 1-based first line of each match.
	 * @param exampleOldString The first match with its neighbouring line, an old_string that tells it apart.
	 */
	editMultipleMatches: (relPath: string, startLines: number[], exampleOldString: string) => {
		const shown = startLines.slice(0, 5).join(", ") + (startLines.length > 5 ? ", ..." : "")
		return [
			`Error: old_string matches ${startLines.length} places in ${relPath} (lines ${shown}). Add an unchanged neighbouring line to old_string so it matches only one place, or set replace_all to true to change all of them.`,
			compactExample("edit", { file_path: relPath, old_string: exampleOldString, new_string: "<new text>" }),
		].join("\n")
	},

	/**
	 * An empty old_string for a file that already has content. Quotes its last lines and
	 * shows how to append after them.
	 */
	editAppendToExistingFile: (relPath: string, last: { startLine: number; lines: string[] }) => {
		// From the end: the old_string must end where the file ends.
		const kept: string[] = []
		let chars = 0
		for (const line of [...last.lines].reverse()) {
			if (kept.length > 0 && chars + line.length + 1 > COMPACT_QUOTE_MAX_CHARS) {
				break
			}
			kept.unshift(line)
			chars += line.length + 1
		}
		if (kept.length === 1 && kept[0].length > COMPACT_QUOTE_MAX_CHARS) {
			// The end of a very long last line still occurs at the end of the file.
			kept[0] = kept[0].slice(-COMPACT_EXAMPLE_LINE_MAX_CHARS)
		}
		const startLine = last.startLine + last.lines.length - kept.length
		const endLine = last.startLine + last.lines.length - 1
		const range = kept.length > 1 ? `lines ${startLine}-${endLine}` : `line ${endLine}`
		const tail = kept.join("\n")
		return [
			`Error: old_string is empty, but ${relPath} already exists. To add text at the end, use its last lines as old_string and repeat them at the start of new_string. The file ends with (${range}):`,
			...kept,
			compactExample("edit", { file_path: relPath, old_string: tail, new_string: `${tail}\n<new text>` }),
		].join("\n")
	},

	/** Appended to a successful edit result when old_string matched only leniently. */
	editMatchNote: (strippedLineNumbers: boolean, whitespace: boolean) => {
		const notes: string[] = []
		if (strippedLineNumbers) {
			notes.push(
				"Note: line numbers were removed from old_string and new_string before matching. Never put line numbers in an edit.",
			)
		}
		if (whitespace) {
			notes.push("Note: old_string matched only after ignoring whitespace differences.")
		}
		return notes.length > 0 ? `\n${notes.join("\n")}` : ""
	},
}

// to avoid circular dependency
const formatImagesIntoBlocks = (images?: string[]): Anthropic.ImageBlockParam[] => {
	return images
		? images.map((dataUrl) => {
				// data:image/png;base64,base64string
				const [rest, base64] = dataUrl.split(",")
				const mimeType = rest.split(":")[1].split(";")[0]
				return {
					type: "image",
					source: { type: "base64", media_type: mimeType, data: base64 },
				} as Anthropic.ImageBlockParam
			})
		: []
}

const toolUseInstructionsReminderNative = `# Reminder: Instructions for Tool Use

Tools are invoked using the platform's native tool calling mechanism. Each tool requires specific parameters as defined in the tool descriptions. Refer to the tool definitions provided in your system instructions for the correct parameter structure and usage examples.

Always ensure you provide all required parameters for the tool you wish to use.`

/**
 * Gets the tool use instructions reminder.
 */
function getToolInstructionsReminder(): string {
	return toolUseInstructionsReminderNative
}
