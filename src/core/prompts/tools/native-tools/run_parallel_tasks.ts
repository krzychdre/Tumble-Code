import type OpenAI from "openai"

const RUN_PARALLEL_TASKS_DESCRIPTION = `Start subagents that work CONCURRENTLY in the background, each a headless agent in its own isolated git worktree (separate branch + working directory). The call returns when the first subagent finishes (or when the user sends you a message); the others keep running.

USE SUBAGENTS OFTEN. Whenever a job can run on its own while you or other subagents do something else, hand it to a subagent instead of doing everything step by step yourself. The user's settings decide how many run at once; extra subtasks wait in a queue, so you never need to hold back.

Good subtasks:
- a question about the code ("what does function X in file Y do and who calls it?");
- a web lookup or documentation research;
- running a test suite or a build and reporting the failures;
- an edit, a fix or a feature part that touches its own files or module;
- checking one hypothesis while you check another.

A subtask must be:
- SELF-CONTAINED: its \`message\` gives all the context and a concrete, checkable outcome. A subagent starts fresh and shares no memory with you or the other subagents.
- INDEPENDENT of the subtasks running at the same time. Start a dependent step only after the result it needs has arrived.
- DONE IN ONE GO: a subagent cannot delegate further (new_task and run_parallel_tasks do not exist inside it). Do the splitting yourself, here.

Do NOT slice one review, audit or design into chunks (for example "review half of the project each"). Reviewers that cannot see each other's work give fragmented, conflicting results. Give such a job to ONE subagent, or delegate it as ONE new_task to the right specialist mode.

Results arrive one by one, as each subagent finishes:
- Call wait_for_subagents to collect the next result.
- One subtask per call is fine: when a result unblocks a follow-up job, start it with run_parallel_tasks while the others keep running.
- While subagents run, keep working on your own part, or call wait_for_subagents when you have nothing else to do.
- If the user sends you a message meanwhile, answer it first. The subagents keep running.
- Do not call attempt_completion before every subagent has reported.

Guidance:
- "architect" and "orchestrator" modes are REJECTED for subtasks; planning and orchestration happen in YOUR task.
- The user can watch each subagent live, answer its clarifying question, or cancel it.
- Worktrees and branches with changes are left intact; nothing is auto-merged. Merge or copy a subagent's changes into your workspace yourself when you need them.

CRITICAL: This tool MUST be called alone. Do NOT call it alongside other tools in the same message turn.`

const SUBTASKS_DESCRIPTION = `The subtasks to run in parallel. Each is an object with a self-contained \`message\` (the full instructions/context for that subtask) and an optional \`mode\` slug (e.g. ask, code, debug; defaults to code).`

const MAX_CONCURRENCY_DESCRIPTION = `Maximum number of subtasks of this call to run at once. Use null to let the user's settings decide (recommended). Values above the user's limits are clamped to them, never rejected.`

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
