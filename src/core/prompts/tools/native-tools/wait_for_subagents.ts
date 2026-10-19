import type OpenAI from "openai"

const WAIT_FOR_SUBAGENTS_DESCRIPTION = `Wait for the subagents you started with run_parallel_tasks. Returns as soon as one of these happens:
- one or more subagents finished: you get their results and the list of subagents still running;
- the user sent you a message: you get it, answer it first, the subagents keep running;
- no subagent is running and no result is waiting.

Call it when you have nothing else to do until a subagent reports. Call it again after each result until every subagent has reported. Do not call attempt_completion while subagents are still running.`

export default {
	type: "function",
	function: {
		name: "wait_for_subagents",
		description: WAIT_FOR_SUBAGENTS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
