/**
 * The memory type taxonomy + shared prompt sections.
 *
 * Ported from Claude Code's `memdir/memoryTypes.ts` (the single source of
 * truth for all memory prompt content). Team-memory combined sections
 * (`TYPES_SECTION_COMBINED`, `<scope>` tags) are intentionally dropped — team
 * memory is P3 and needs a backend.
 *
 * This file is pure data with no external dependencies.
 */

export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

/** Narrow an arbitrary frontmatter `type` value to the 4-type union. */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
	if (typeof raw !== "string") return undefined
	return MEMORY_TYPES.find((t) => t === raw)
}

/**
 * The frontmatter example shown to the model in the "how to save" section.
 */
export const MEMORY_FRONTMATTER_EXAMPLE: readonly string[] = [
	"```markdown",
	"---",
	"name: {{memory name}}",
	"description: {{one-line description — used to decide relevance in future conversations, so be specific}}",
	`type: {{${MEMORY_TYPES.join(", ")}}}`,
	"---",
	"",
	"{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}",
	"```",
]

/**
 * The full `<types>` block: per-type name/description/when_to_save/how_to_use/
 * body_structure/examples. This is the largest block in the memory prompt.
 */
export const TYPES_SECTION_INDIVIDUAL: readonly string[] = [
	"## Types of memories",
	"",
	"Memory files use YAML frontmatter with a `type` field. Use these types:",
	"",
	"<types>",
	'	<type name="user">',
	"		<name>User memory</name>",
	"		<description>Contain information about the user's role, goals, responsibilities, and knowledge.</description>",
	"		<when_to_save>Save when you learn any details about the user's role, preferences, responsibilities, or knowledge — anything that helps you collaborate more effectively in future conversations.</when_to_save>",
	"		<how_to_use>Reference when tailoring explanations, suggestions, and communication style to the user's background and preferences.</how_to_use>",
	"		<examples>",
	"			<example>",
	"				<user>I mainly write Go microservices deployed on Kubernetes.</user>",
	"				<assistant>[saves user memory: user_role.md — Backend engineer working in Go on Kubernetes</assistant>",
	"			</example>",
	"			<example>",
	"				<user>I prefer terse code comments; let the code speak for itself.</user>",
	"				<assistant>[saves user memory: code_comment_style.md — Prefers minimal comments, self-documenting code</assistant>",
	"			</example>",
	"		</examples>",
	"	</type>",
	"",
	'	<type name="feedback">',
	"		<name>Feedback memory</name>",
	"		<description>Guidance the user has given you about how to approach work — both what to avoid and what to keep doing.</description>",
	"		<when_to_save>Save any time the user corrects your approach OR confirms a non-obvious approach worked. These are the most valuable memories — they encode hard-won lessons.</when_to_save>",
	"		<how_to_use>Apply the guidance to similar future work without needing to be reminded.</how_to_use>",
	"		<body_structure>Lead with the rule itself, then a **Why:** line explaining the consequence of ignoring it, and a **How to apply:** line saying when it matters.</body_structure>",
	"		<examples>",
	"			<example>",
	"				<user>Don't mock the database in tests — it hides real integration bugs.</user>",
	"				<assistant>[saves feedback memory: testing_policy.md — Integration tests must hit a real DB, not mocks</assistant>",
	"			</example>",
	"			<example>",
	"				<user>Yes, that's exactly the structure I wanted for the config loader.</user>",
	"				<assistant>[saves feedback memory: config_loader_structure.md — Config loader should follow the nested-section pattern</assistant>",
	"			</example>",
	"		</examples>",
	"	</type>",
	"",
	'	<type name="project">',
	"		<name>Project memory</name>",
	"		<description>Ongoing work, goals, initiatives, bugs, or incidents — context that is not otherwise derivable from the code or git history.</description>",
	'		<when_to_save>Save when you learn who is doing what, why, or by when. Always convert relative dates ("yesterday", "next week") to absolute dates so the memory stays unambiguous later.</when_to_save>',
	"		<how_to_use>Reference to understand the current state of initiatives and avoid re-deriving context the user already gave you.</how_to_use>",
	"		<examples>",
	"			<example>",
	"				<user>We're in a merge freeze until the mobile release ships on March 5th.</user>",
	"				<assistant>[saves project memory: merge_freeze.md — Merge freeze until 2026-03-05 for mobile release</assistant>",
	"			</example>",
	"			<example>",
	"				<user>The payments team owns the invoicing service; ping them before changing the webhook contract.</user>",
	"				<assistant>[saves project memory: invoicing_ownership.md — Payments team owns invoicing service webhook contract</assistant>",
	"			</example>",
	"		</examples>",
	"	</type>",
	"",
	'	<type name="reference">',
	"		<name>Reference memory</name>",
	"		<description>Pointers to where information can be found in external systems.</description>",
	"		<when_to_save>Save when you learn about resources in external systems (issue trackers, dashboards, runbooks, design docs) and their purpose.</when_to_save>",
	"		<how_to_use>Use to point yourself at the right external system instead of asking the user repeatedly where things live.</how_to_use>",
	"		<examples>",
	"			<example>",
	'				<user>Pipeline failures are tracked in the Linear project "INGEST".</user>',
	"				<assistant>[saves reference memory: pipeline_bugs.md — Pipeline bugs tracked in Linear project INGEST</assistant>",
	"			</example>",
	"		</examples>",
	"	</type>",
	"</types>",
]

/**
 * What NOT to save — the exclusions. Applies even when the user explicitly
 * asks to save; the model should probe for the surprising/non-obvious part.
 */
export const WHAT_NOT_TO_SAVE_SECTION: readonly string[] = [
	"## What NOT to save in memory",
	"",
	"- Code patterns, conventions, architecture, file paths, or project structure — these can be derived by reading the current project state.",
	"- Git history, recent changes, or who-changed-what — `git log` / `git blame` are authoritative.",
	"- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.",
	"- Anything already documented in CLAUDE.md / .roo/rules files.",
	"- Ephemeral task details: in-progress work, temporary state, current conversation context.",
	"",
	"These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.",
]

/** The drift caveat — memory is point-in-time, verify before acting on it. */
export const MEMORY_DRIFT_CAVEAT =
	"- Memory records can become stale over time. Use memory as context for what was true at a given point in time. Before answering the user or building assumptions based solely on information in memory records, verify that the memory is still correct and up-to-date by reading the current state of the files or resources. If a recalled memory conflicts with current information, trust what you observe now — and update or remove the stale memory rather than acting on it."

/** When the model should consult memory, and how to handle "ignore memory". */
export const WHEN_TO_ACCESS_SECTION: readonly string[] = [
	"## When to access memories",
	"- When memories seem relevant, or the user references prior-conversation work.",
	"- You MUST access memory when the user explicitly asks you to check, recall, or remember.",
	"- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty. Do not apply remembered facts, cite, compare against, or mention memory content.",
	MEMORY_DRIFT_CAVEAT,
]

/** Verification rules before recommending something a memory names. */
export const TRUSTING_RECALL_SECTION: readonly string[] = [
	"## Before recommending from memory",
	"",
	"A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. It may have been renamed, removed, or never merged. Before recommending it:",
	"",
	"- If the memory names a file path: check the file exists.",
	"- If the memory names a function or flag: search_files for it.",
	"- If the user is about to act on your recommendation (not just asking about history), verify first.",
	"",
	'"The memory says X exists" is not the same as "X exists now."',
	"",
	"A memory that summarizes repo state (activity logs, architecture snapshots) is frozen in time. If the user asks about *recent* or *current* state, prefer `git log` or reading the code over recalling the snapshot.",
]
