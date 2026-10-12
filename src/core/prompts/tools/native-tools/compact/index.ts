import type OpenAI from "openai"

/**
 * Tool definitions for a profile with `compactProfile` on (see
 * ai_plans/2026-10-10_19-36_compact-small-model-profile.md, "Compact toolset").
 *
 * The profile is for small local models with a window of about 40k tokens. The
 * full definitions (`../*.ts`) cost about 30k characters in code mode, carry
 * long rule lists, and offer optional parameters (read_file's `mode` and
 * `indentation`, execute_command's `timeout`) that a 4B model fills in for no
 * reason. These definitions keep:
 *
 * - one short description per tool (at most about 300 characters), and one
 *   tiny example only where it prevents a mistake we saw (`edit`);
 * - only the parameters the compact profile needs, under the SAME names the
 *   parsers in `src/core/tools/toolArgParsers.ts` read, so dispatch is shared
 *   with the full definitions;
 * - plain JSON schemas: `required` lists only what the parser requires, there
 *   are no nullable unions, and there is no `strict` flag. The OpenAI-compatible
 *   conversion keeps them as they are under compact (`convertToolsForOpenAI`),
 *   so an optional parameter stays optional for the model.
 *
 * Order matters for the local server's prompt cache: the tools every mode has
 * come first, then the edit tools, then the command tool. The ask array is then
 * a prefix of the architect array, which is a prefix of the code array, so a
 * mode switch keeps the longest possible common prefix.
 *
 * Nothing here is used when the flag is off.
 */

type Tool = OpenAI.Chat.ChatCompletionFunctionTool

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): Tool {
	return {
		type: "function",
		function: {
			name,
			description,
			parameters: { type: "object", properties, required, additionalProperties: false },
		},
	}
}

/** A fresh object per use, so no two schemas share a node a converter could change. */
const pathParam = () => ({ type: "string", description: "Path relative to the workspace" })

const compactReadFile = tool(
	"read_file",
	"Read one file. Returns a header line, then the file's lines without line numbers, as stored except that a line over 2000 characters is cut short. " +
		"Omit offset and limit to read from the start; use them only to continue a long file.",
	{
		path: pathParam(),
		offset: { type: "integer", description: "1-based line to start at" },
		limit: { type: "integer", description: "Maximum number of lines" },
	},
	["path"],
)

const compactListFiles = tool(
	"list_files",
	"List the files and directories in a directory. Top level only unless recursive is true.",
	{
		path: pathParam(),
		recursive: { type: "boolean", description: "true to include subdirectories" },
	},
	["path"],
)

const compactSearchFiles = tool(
	"search_files",
	"Search file contents under a directory with a regular expression (Rust syntax). Returns the matching lines with some context.",
	{
		path: pathParam(),
		regex: { type: "string", description: "Regular expression to find" },
		file_pattern: { type: "string", description: "Glob that limits the files, for example *.md" },
	},
	["path", "regex"],
)

const compactAskFollowupQuestion = tool(
	"ask_followup_question",
	"Ask the user a question. Only when no tool can find the answer.",
	{
		question: { type: "string", description: "The question" },
		follow_up: {
			type: "array",
			items: { type: "string" },
			minItems: 1,
			maxItems: 4,
			description: "1 to 4 short suggested answers",
		},
	},
	["question", "follow_up"],
)

const compactAttemptCompletion = tool(
	"attempt_completion",
	"Finish the task and give the user the result. Use it only after your last tool call succeeded.",
	{ result: { type: "string", description: "The final result, without a question at the end" } },
	["result"],
)

const compactSwitchMode = tool(
	"switch_mode",
	"Switch to another mode, for example code to change files.",
	{
		mode_slug: { type: "string", description: "Mode slug, for example code or ask" },
		reason: { type: "string", description: "Why you need the switch" },
	},
	["mode_slug", "reason"],
)

const compactWebSearch = tool(
	"web_search",
	"Search the web. Returns titles, URLs and snippets.",
	{
		queries: {
			type: "array",
			items: { type: "string" },
			minItems: 1,
			maxItems: 4,
			description: "1 to 4 short search queries",
		},
	},
	["queries"],
)

const compactWebFetch = tool(
	"web_fetch",
	"Fetch one web page and return it as markdown.",
	{ url: { type: "string", description: "Absolute http(s) URL" } },
	["url"],
)

const compactEdit = tool(
	"edit",
	"Replace text in an existing file. Copy old_string exactly from read_file output (no line numbers), " +
		"with enough lines to match only once, or set replace_all. " +
		'To add a line after "- a": {"file_path":"x.md","old_string":"- a","new_string":"- a\\n- b"}',
	{
		file_path: pathParam(),
		old_string: { type: "string", description: "Exact current text" },
		new_string: { type: "string", description: "Replacement text" },
		replace_all: { type: "boolean", description: "true to replace every match" },
	},
	["file_path", "old_string", "new_string"],
)

const compactWriteToFile = tool(
	"write_to_file",
	"Create a file, or replace a whole file. Give the complete content, without line numbers. Use edit to change part of a file.",
	{
		path: pathParam(),
		content: { type: "string", description: "The complete file content" },
	},
	["path", "content"],
)

const compactExecuteCommand = tool(
	"execute_command",
	"Run a shell command and return its output and exit code. Use the syntax of the user's shell.",
	{
		command: { type: "string", description: "The command" },
		cwd: { type: "string", description: "Directory to run in, default the workspace" },
	},
	["command"],
)

/**
 * The compact definitions in their advertised order. The mode filter
 * (`filterNativeToolsForMode` with `applyCompactToolset`) picks from this list,
 * so a tool absent here is never advertised under compact.
 */
export function getCompactNativeTools(): Tool[] {
	return [
		compactReadFile,
		compactListFiles,
		compactSearchFiles,
		compactAskFollowupQuestion,
		compactAttemptCompletion,
		compactSwitchMode,
		compactWebSearch,
		compactWebFetch,
		compactEdit,
		compactWriteToFile,
		compactExecuteCommand,
	]
}
