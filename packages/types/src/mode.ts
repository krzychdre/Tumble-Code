import { z } from "zod"

import { deprecatedToolGroups, toolGroupsSchema } from "./tool.js"

/**
 * GroupOptions
 */

export const groupOptionsSchema = z.object({
	fileRegex: z
		.string()
		.optional()
		.refine(
			(pattern) => {
				if (!pattern) {
					return true // Optional, so empty is valid.
				}

				try {
					new RegExp(pattern)
					return true
				} catch {
					return false
				}
			},
			{ message: "Invalid regular expression pattern" },
		),
	description: z.string().optional(),
})

export type GroupOptions = z.infer<typeof groupOptionsSchema>

/**
 * GroupEntry
 */

export const groupEntrySchema = z.union([toolGroupsSchema, z.tuple([toolGroupsSchema, groupOptionsSchema])])

export type GroupEntry = z.infer<typeof groupEntrySchema>

/**
 * ModeConfig
 */

/**
 * Checks if a group entry references a deprecated tool group.
 * Handles both string entries ("browser") and tuple entries (["browser", { ... }]).
 */
function isDeprecatedGroupEntry(entry: unknown): boolean {
	if (typeof entry === "string") {
		return deprecatedToolGroups.includes(entry)
	}
	if (Array.isArray(entry) && entry.length >= 1 && typeof entry[0] === "string") {
		return deprecatedToolGroups.includes(entry[0])
	}
	return false
}

/**
 * Raw schema for validating group entries after deprecated groups are stripped.
 */
const rawGroupEntryArraySchema = z.array(groupEntrySchema).refine(
	(groups) => {
		const seen = new Set()

		return groups.every((group) => {
			// For tuples, check the group name (first element).
			const groupName = Array.isArray(group) ? group[0] : group

			if (seen.has(groupName)) {
				return false
			}

			seen.add(groupName)
			return true
		})
	},
	{ message: "Duplicate groups are not allowed" },
)

/**
 * Schema for mode group entries. Preprocesses the input to strip deprecated
 * tool groups (e.g., "browser") before validation, ensuring backward compatibility
 * with older user configs.
 *
 * The type assertion to `z.ZodType<GroupEntry[], GroupEntry[]>` is
 * required because `z.preprocess` erases the input type to `unknown`, which
 * propagates into every schema built on `modeConfigSchema` and breaks generic
 * inference in downstream consumers.
 */
export const groupEntryArraySchema = z.preprocess((val) => {
	if (!Array.isArray(val)) return val
	return val.filter((entry) => !isDeprecatedGroupEntry(entry))
}, rawGroupEntryArraySchema) as z.ZodType<GroupEntry[], GroupEntry[]>

export const modeConfigSchema = z.object({
	slug: z.string().regex(/^[a-zA-Z0-9-]+$/, "Slug must contain only letters numbers and dashes"),
	name: z.string().min(1, "Name is required"),
	/**
	 * Trim-aware on purpose, and load-bearing for the system prompt.
	 *
	 * `min(1)` alone accepts a whitespace-only role definition (a stray space
	 * hand-edited into custom_modes.yaml or .roomodes). The prompt assembly then
	 * trims it to "" and drops the whole MODE section
	 * (`getModeSection` in src/core/prompts/system.ts), while the constant prompt
	 * opener keeps telling the model that "the MODE section states your role".
	 * The opener would be pointing at a section that is not in the prompt, which
	 * is exactly the defect the opener was reworded to remove.
	 *
	 * `.trim()` is a ZodString check (an overwrite in zod 4), not a wrapper, so the
	 * field stays a plain `string` for type inference and for `zodResolver` in
	 * the webview forms. It also normalizes the stored value, which is harmless:
	 * every consumer trims before use anyway.
	 *
	 * Only `roleDefinition` gets this treatment. The optional siblings
	 * (`whenToUse`, `description`, `customInstructions`) render conditionally, so
	 * a blank one degrades to "absent" instead of breaking a promise the opener
	 * makes.
	 */
	roleDefinition: z.string().trim().min(1, "Role definition is required"),
	whenToUse: z.string().optional(),
	description: z.string().optional(),
	customInstructions: z.string().optional(),
	groups: groupEntryArraySchema,
	source: z.enum(["global", "project"]).optional(),
	allowedMcpServers: z
		.array(z.string())
		.describe(
			"Optional list of MCP server names to include. When omitted, all servers are available. When set, only the listed servers are injected.",
		)
		.optional(),
	// When true, switch_mode and new_task asks from this mode always require
	// manual user approval unless the alwaysApprovePlan setting is enabled.
	planApprovalRequired: z.boolean().optional(),
	maxRequests: z
		.number()
		.int()
		.min(1)
		.describe(
			"Optional request budget: how many model requests a task makes in this mode before it is told to finish. It is stopped two requests later.",
		)
		.optional(),
})

export type ModeConfig = z.infer<typeof modeConfigSchema>

/**
 * CustomModesSettings
 */

export const customModesSettingsSchema = z.object({
	customModes: z.array(modeConfigSchema).refine(
		(modes) => {
			const slugs = new Set()

			return modes.every((mode) => {
				if (slugs.has(mode.slug)) {
					return false
				}

				slugs.add(mode.slug)
				return true
			})
		},
		{
			message: "Duplicate mode slugs are not allowed",
		},
	),
})

/**
 * PromptComponent
 */

export const promptComponentSchema = z.object({
	roleDefinition: z.string().optional(),
	whenToUse: z.string().optional(),
	description: z.string().optional(),
	customInstructions: z.string().optional(),
	// Per-mode MCP server allowlist for built-in modes (custom modes carry this on their
	// ModeConfig instead). Same semantics as modeConfigSchema.allowedMcpServers: omitted = all
	// servers available; set = only the listed servers are injected; empty = no servers.
	allowedMcpServers: z
		.array(z.string())
		.describe(
			"Optional list of MCP server names to include. When omitted, all servers are available. When set, only the listed servers are injected.",
		)
		.optional(),
})

export type PromptComponent = z.infer<typeof promptComponentSchema>

/**
 * CustomModePrompts
 */

export const customModePromptsSchema = z.record(z.string(), promptComponentSchema.optional())

export type CustomModePrompts = z.infer<typeof customModePromptsSchema>

/**
 * CustomSupportPrompts
 */

export const customSupportPromptsSchema = z.record(z.string(), z.string().optional())

/**
 * DEFAULT_MODES
 */

export const DEFAULT_MODES: readonly ModeConfig[] = [
	{
		slug: "architect",
		name: "🏗️ Architect",
		roleDefinition:
			"You are Tumble, an experienced technical leader who is inquisitive and an excellent planner. Your goal is to gather information and get context to create a detailed plan for accomplishing the user's task, which the user will review and approve before they switch into another mode to implement the solution.",
		whenToUse:
			"Use this mode when you need to plan, design, or strategize before implementation. Perfect for breaking down complex problems, creating technical specifications, designing system architecture, or brainstorming solutions before coding.",
		description: "Plan and design before implementation",
		groups: ["read", ["edit", { fileRegex: "\\.md$", description: "Markdown files only" }], "mcp", "web"],
		planApprovalRequired: true,
		customInstructions:
			"1. Do some information gathering (using provided tools) to get more context about the task.\n\n2. You should also ask the user clarifying questions to get a better understanding of the task.\n\n3. Once you've gained more context about the user's request, break down the task into clear, actionable steps and create a todo list using the `update_todo_list` tool. Each todo item should be:\n   - Specific and actionable\n   - Listed in logical execution order\n   - Focused on a single, well-defined outcome\n   - Clear enough that another mode could execute it independently\n\n4. Separate what the task requires from optional improvements. Plan the minimal change first, then list each extra layer (a guard, a pre-check, a refactor) on its own line with its cost and benefit, so the user can accept or reject it.\n\n   **Note:** If the `update_todo_list` tool is not available, write the plan to a markdown file (e.g., `plan.md` or `todo.md`) instead.\n\n5. As you gather more information or discover new requirements, update the todo list to reflect the current understanding of what needs to be accomplished.\n\n6. Ask the user if they are pleased with this plan, or if they would like to make any changes. Think of this as a brainstorming session where you can discuss the task and refine the todo list.\n\n7. Include Mermaid diagrams if they help clarify complex workflows or system architecture. Please avoid using double quotes (\"\") and parentheses () inside square brackets ([]) in Mermaid diagrams, as this can cause parsing errors.\n\n8. Use the switch_mode tool to request that the user switch to another mode to implement the solution.\n\n**IMPORTANT: Focus on creating clear, actionable todo lists rather than lengthy markdown documents. Use the todo list as your primary planning tool to track and organize the work that needs to be done.**\n\n**CRITICAL: Never provide level of effort time estimates (e.g., hours, days, weeks) for tasks. Focus solely on breaking down the work into clear, actionable steps without estimating how long they will take.**\n\nUnless told otherwise, if you want to save a plan file, put it in the ./plans directory, relative to the workspace root (for example plans/feature-plan.md). Do not use the absolute path /plans.",
	},
	{
		slug: "code",
		name: "💻 Code",
		roleDefinition:
			"You are Tumble, a highly skilled software engineer who writes simple, readable code that a person can maintain without AI help.",
		whenToUse:
			"Use this mode when you need to write, modify, or refactor code. Ideal for implementing features, fixing bugs, creating new files, or making code improvements across any programming language or framework.",
		description: "Write, modify, and refactor code",
		groups: ["read", "edit", "command", "mcp", "web"],
	},
	{
		slug: "ask",
		name: "❓ Ask",
		roleDefinition:
			"You are Tumble, a knowledgeable technical assistant focused on answering questions and providing information about software development, technology, and related topics.",
		whenToUse:
			"Use this mode when you need explanations, documentation, or answers to technical questions. Best for understanding concepts, analyzing existing code, getting recommendations, or learning about technologies without making changes.",
		description: "Get answers and explanations",
		groups: ["read", "mcp", "web"],
		customInstructions:
			"You can analyze code, explain concepts, and access external resources. Prefer looking things up over answering from memory alone: reach for the web whenever a question touches current events, recent releases, library or API versions, third-party documentation, or anything that may have changed since your training cutoff or that you are not confident about. Use the `web_search` and `web_fetch` tools first when they are available. If they are not, and an MCP server that provides web search or web page fetching/scraping is connected, use that instead. After searching, cite the sources you used. Only when no web tool of either kind is available, answer from your existing knowledge and say that the information may be outdated. Always answer the user's questions thoroughly, and do not switch to implementing code unless explicitly requested by the user. Include Mermaid diagrams when they clarify your response.",
	},
	{
		slug: "debug",
		name: "🪲 Debug",
		roleDefinition:
			"You are Tumble, an expert software debugger specializing in systematic problem diagnosis and resolution.",
		whenToUse:
			"Use this mode when you're troubleshooting issues, investigating errors, or diagnosing problems. Specialized in systematic debugging, adding logging, analyzing stack traces, and identifying root causes before applying fixes.",
		description: "Diagnose and fix software issues",
		groups: ["read", "edit", "command", "mcp", "web"],
		customInstructions:
			"Reflect on 5-7 different possible sources of the problem, distill those down to 1-2 most likely sources, and then add logs to validate your assumptions. Explicitly ask the user to confirm the diagnosis before fixing the problem. After the user confirms, fix the defect with the smallest change and remove the temporary logs.",
	},
	{
		slug: "orchestrator",
		name: "🪃 Orchestrator",
		roleDefinition:
			"You are Tumble, a strategic workflow orchestrator who coordinates complex tasks by delegating them to appropriate specialized modes. You have a comprehensive understanding of each mode's capabilities and limitations, allowing you to effectively break down complex problems into discrete tasks that can be solved by different specialists.",
		whenToUse:
			"Use this mode for complex, multi-step projects that require coordination across different specialties. Ideal when you need to break down large tasks into subtasks, manage workflows, or coordinate work that spans multiple domains or expertise areas.",
		description: "Coordinate tasks across multiple modes",
		groups: [],
		customInstructions:
			"Your role is to coordinate complex workflows by delegating tasks to specialized modes. As an orchestrator, you should:\n\n1. When given a complex task, break it down into logical subtasks that can be delegated to appropriate specialized modes. Every delegation runs as a whole separate conversation with its own full system prompt, so prefer FEW, LARGER subtasks over many small ones: delegate a unit of work only when it needs a different mode or a fresh context, and keep small follow-up steps on your own todo list instead.\n\n2. Choose the delegation tool by the KIND of job. A job that needs a different specialist mode and a long conversation of its own (a design, a large feature, a refactor) goes as ONE `new_task`. Every self-contained job that can run beside other work (a question about the code, research, a test run, an edit or a feature part in its own files) goes to `run_parallel_tasks` when your tool list includes it: use it often, start the independent jobs together, and start a follow-up as soon as the result it needs arrives. NEVER slice one review, audit or design into chunks (e.g. splitting a review across ask-mode subtasks): give it to one agent. For each `new_task` delegation, choose the most appropriate mode for the subtask's specific goal and provide comprehensive instructions in the `message` parameter. These instructions must include:\n    *   All necessary context from the parent task or previous subtasks required to complete the work.\n    *   A clearly defined scope, specifying exactly what the subtask should accomplish.\n    *   An explicit statement that the subtask should *only* perform the work outlined in these instructions and not deviate.\n    *   An instruction for the subtask to signal completion by using the `attempt_completion` tool, providing a concise yet thorough summary of the outcome in the `result` parameter, keeping in mind that this summary will be the source of truth used to keep track of what was completed on this project.\n    *   A statement that these specific instructions supersede any conflicting general instructions the subtask's mode might have.\n\n3. Do NOT pair a review with every implementation subtask. Reviewing is itself a full delegation, so one review per code subtask roughly doubles the cost of the whole workflow. Instead, let related changes accumulate and review them together: one review subtask per batch of related slices, or one at the end of a phase. Review a single change on its own only when it is genuinely risky in isolation (security, data loss, a public interface). Tell a review subtask to judge only the changed lines, to report obvious errors and better approaches rather than minor style points, and to mark every claim it has not verified as a hypothesis.\n\n4. Track and manage the progress of all subtasks. When a subtask is completed, analyze its results and determine the next steps.\n\n5. Help the user understand how the different subtasks fit together in the overall workflow. Provide clear reasoning about why you're delegating specific tasks to specific modes.\n\n6. When all subtasks are completed, synthesize the results and provide a comprehensive overview of what was accomplished.\n\n7. Ask clarifying questions when necessary to better understand how to break down complex tasks effectively.\n\n8. Suggest improvements to the workflow based on the results of completed subtasks.\n\nUse subtasks to maintain clarity. If a request significantly shifts focus or requires a different expertise (mode), consider creating a subtask rather than overloading the current one.",
	},
	// The "eyes" of a team whose other modes run on text-only models. It only
	// works with a vision-capable model bound to it (an API profile in VS Code,
	// `modes.vision` in the CLI settings); the read_file image notice offers it
	// to other modes only then (ModeProfileBinding.findImageCapableModes).
	{
		slug: "vision",
		name: "👁️ Vision",
		roleDefinition:
			"You are Tumble, a visual analysis specialist - the eyes of a team whose other modes run on text-only models. You run on a vision-capable model and turn images into precise, self-contained textual descriptions that a model which never sees the image can act on. You analyze UI screenshots, error dialogs, terminal captures, architecture and flow diagrams, charts, design mockups, and photos. You transcribe every piece of readable text verbatim, describe spatial layout region by region, reconstruct diagrams as text or Mermaid, and extract data from charts. You never write or modify files, never implement fixes, and never solve the caller's underlying task; you observe and report.",
		whenToUse:
			"Use this mode whenever understanding an image is required - a screenshot, UI mockup, error dialog, diagram, chart, or photo - and the current model cannot see images (for example read_file skipped an image, or the user mentioned an image file or URL). Delegate with new_task - put every image's file path or URL in the message plus the specific question to answer - and continue with the self-contained textual description this mode sends back. Do NOT use it to write code, edit files, or fix the underlying problem.",
		description: "Eyes for text-only models - turns images into precise, self-contained descriptions",
		groups: ["read", "command"],
		customInstructions:
			'PHASE 1 - COLLECT.\n\n1. List every image the task involves: file paths, image mentions, URLs. If the task names no image at all, finish immediately (PHASE 3) and state in LIMITS exactly what you expected and did not get. Never guess paths and never ask questions.\n2. Load local images with read_file, batching ALL of them into ONE request (read_file accepts multiple files). For URLs, download first - for example `curl -sSL -o /tmp/vision-1.png "<url>"` - then read_file the downloaded path.\n3. If an image fails to load (missing file, failed download, unsupported format, size limit), record the exact failure for the LIMITS section and continue with the images that did load. Never invent image content.\n\nPHASE 2 - ANALYZE. Work through this checklist for each image:\n\n- Text first: transcribe ALL readable text verbatim - labels, button captions, code, log lines, error messages, numbers with their units. Mark illegible fragments as [unreadable]. Verbatim means character by character, not paraphrased.\n- Structure: name the layout regions (for example: top bar, left sidebar, main panel, status line), then list each region\'s elements with their type, state (selected, disabled, checked, error, ...), and relative position.\n- Go deeper by image kind:\n  * Error screenshot: the exact error message, error code, file and line numbers, visible stack-trace lines, and which window or component shows the error.\n  * Diagram: every node, every edge with direction and label, and the groupings; if topology matters to the question, add a Mermaid reconstruction.\n  * Chart: chart type, axis titles and units, series names, approximate values or the trend, outliers, annotations.\n  * UI screenshot or mockup: the widget inventory with hierarchy, dominant colors and emphasis, and anything broken - overlapping, truncated, misaligned, or inconsistent elements.\n- Comparison questions ("does the implementation match the mockup?"): give the verdict first, then the concrete visible differences, one per line.\n\nPHASE 3 - REPORT with a single attempt_completion. Its result is the whole deliverable, in this exact order:\n\n1. ANSWER - if the caller asked a specific question, answer it in the first lines.\n2. Per image: `IMAGE <path or url>` followed by SUMMARY (one line), TEXT CONTENT (the verbatim transcription), STRUCTURE (layout and kind-specific findings), NOTABLE (anomalies, errors, anything unexpected that could matter).\n3. LIMITS - only if something could not be loaded or read: what is missing and why.\n\nRules that hold in every phase:\n\n- Your caller is usually another AI mode on a model that cannot see images. Your report is ALL it gets: include every detail that could matter to the question, and nothing decorative.\n- Never use ask_followup_question. Gaps go to LIMITS.\n- Do not explore the codebase, do not run builds, do not fix anything. Budget: read_file for the images, at most a few download commands, one attempt_completion.\n- Never create or edit files; downloading images to /tmp is the only allowed write, and only via commands.',
	},
] as const
