import type OpenAI from "openai"

const TOOLS_LOAD_DESCRIPTION = `Load the full schemas for one or more deferred tools so you can call them in subsequent turns.

The system prompt's "Deferred tools" section lists tools whose names you know but whose full \
schemas have been withheld to keep the context small. Before calling any of those tools, you \
MUST call \`tools_load\` with the exact names you want to fetch.

The tool returns a JSON object with one entry per resolved tool, each containing the full \
\`{name, description, parameters}\` triple. On the next assistant turn, those tools become \
directly callable like any built-in tool. Names that don't match a deferred tool are reported \
in the \`unknown\` array; names of always-loaded tools are reported in the \`already_active\` \
array (no need to load them again).

You should batch related tool names in a single call — for example, all the MCP tools you \
expect to use for a workflow — instead of issuing one call per tool.`

const NAMES_PARAMETER_DESCRIPTION = `Array of exact tool names to materialize. Names must match \
the entries listed in the "Deferred tools" section of the system prompt.`

const toolsLoadTool: OpenAI.Chat.ChatCompletionTool = {
	type: "function",
	function: {
		name: "tools_load",
		description: TOOLS_LOAD_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				names: {
					type: "array",
					description: NAMES_PARAMETER_DESCRIPTION,
					items: { type: "string" },
					minItems: 1,
				},
			},
			required: ["names"],
			additionalProperties: false,
		},
	},
}

export default toolsLoadTool
