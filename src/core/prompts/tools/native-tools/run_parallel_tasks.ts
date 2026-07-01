import type OpenAI from "openai"

const RUN_PARALLEL_TASKS_DESCRIPTION = `Run several independent subtasks CONCURRENTLY, each as a headless agent in its own isolated git worktree (separate branch + working directory), then get back an aggregated report of every subtask's result.

Use this to decompose one job into parts that can run at the same time for speed — e.g. "refactor these 3 modules", "write tests for these files", "investigate these areas in parallel". Each subtask runs autonomously (no user interaction) and cannot see the others' work while running; results are merged into your next turn.

Guidance:
- Only split work that is genuinely INDEPENDENT. Dependent steps must be sequential, not parallel.
- Give each subtask a self-contained \`message\` with all the context it needs — a subtask starts fresh and shares no memory with you or its siblings.
- Worktrees and branches are left intact for review; nothing is auto-merged.

CRITICAL: This tool MUST be called alone. Do NOT call it alongside other tools in the same message turn.`

const SUBTASKS_DESCRIPTION = `The subtasks to run in parallel. Each is an object with a self-contained \`message\` (the full instructions/context for that subtask) and an optional \`mode\` slug (e.g. code, debug, architect; defaults to code).`

const MAX_CONCURRENCY_DESCRIPTION = `Maximum number of subtasks to run at once (default 3). Use null for the default. Keep modest to respect API rate limits.`

export default {
	type: "function",
	function: {
		name: "run_parallel_tasks",
		description: RUN_PARALLEL_TASKS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				subtasks: {
					type: "array",
					description: SUBTASKS_DESCRIPTION,
					items: {
						type: "object",
						properties: {
							message: {
								type: "string",
								description: "Self-contained instructions and context for this subtask.",
							},
							mode: {
								type: ["string", "null"],
								description: "Mode slug to run this subtask in (e.g. code, debug). Null = code.",
							},
						},
						required: ["message", "mode"],
						additionalProperties: false,
					},
				},
				maxConcurrency: {
					type: ["number", "null"],
					description: MAX_CONCURRENCY_DESCRIPTION,
				},
			},
			required: ["subtasks", "maxConcurrency"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
