import { ALWAYS_AVAILABLE_TOOLS, type GroupEntry, type ToolGroup } from "@tumble-code/types"

import { getGroupName } from "../../../shared/modes"
import { resolveToolAlias } from "../tools/filter-tools-for-mode"

/** The groups whose absence the section reports, in the order it reports them. */
const REPORTED_GROUPS = ["command", "read", "edit"] as const satisfies readonly ToolGroup[]

type ReportedGroup = (typeof REPORTED_GROUPS)[number]

/** What the mode cannot do without each group, phrased to follow "This mode cannot". */
const MISSING_ABILITY: Record<ReportedGroup, string> = {
	command: "run shell commands (there is no execute_command tool)",
	read: "read or search files (there is no read_file, list_files or search_files tool)",
	edit: "edit files (there is no write_to_file or apply_diff tool)",
}

/** The kind of work each group does, for "When the work needs ...". */
const WORK_KIND: Record<ReportedGroup, string> = {
	command: "commands",
	read: "files",
	edit: "files",
}

export interface ModeToolLimitsOptions {
	/**
	 * Tool names this request removes on top of the mode's groups: the user's
	 * `disabledTools`, the model's `excludedTools`, and `new_task` for a
	 * background task. Only consulted for `new_task` and `switch_mode`, so the
	 * section never points at a way out the tool list does not have.
	 */
	removedTools?: readonly string[]
	/**
	 * The mode named as the example delegation target (normally `code`, custom
	 * overrides included). Named only when it really has every group the current
	 * mode lacks; otherwise the section names no mode at all.
	 */
	exampleMode?: { slug: string; groups: readonly GroupEntry[] }
}

/** "a", "a and b", "a, b and c". */
function joinWithAnd(items: string[]): string {
	return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/**
 * Builds the TOOLS IN THIS MODE section (variable tail).
 *
 * CAPABILITIES is in the stable head, so it can only say that the tool list is
 * the source of truth; it cannot say what THIS mode lacks. A weak model that
 * reads "depending on the mode, it can include tools to run CLI commands" still
 * guesses, and the orchestrator guessed wrong (it called execute_command with
 * `groups: []`, vLLM dropped the call, and the task looped on empty answers).
 * This section states the missing capabilities plainly and names the way out.
 *
 * Derived from the mode's groups only, so it changes exactly when the mode
 * does. Returns "" (zero bytes) when the mode has `command`, `read` and `edit`,
 * which keeps the prompt of code and debug byte-identical to a build without
 * this section. `new_task` and `switch_mode` are always-available tools, so
 * the only thing that can take them away is the request's removal list.
 */
export function getModeToolLimitsSection(groups: readonly GroupEntry[], options: ModeToolLimitsOptions = {}): string {
	const present = new Set(groups.map((group) => getGroupName(group)))
	const missing = REPORTED_GROUPS.filter((group) => !present.has(group))

	if (missing.length === 0) {
		return ""
	}

	const removed = new Set((options.removedTools ?? []).map((tool) => resolveToolAlias(tool)))
	const isAvailable = (tool: "new_task" | "switch_mode") =>
		ALWAYS_AVAILABLE_TOOLS.includes(tool) && !removed.has(tool)
	const canDelegate = isAvailable("new_task")
	const canSwitch = isAvailable("switch_mode")

	const example = options.exampleMode
	const exampleGroups = new Set(example?.groups.map((group) => getGroupName(group)) ?? [])
	const exampleHint =
		example && missing.every((group) => exampleGroups.has(group)) ? ` (for example ${example.slug})` : ""

	const abilities = joinWithAnd(missing.map((group) => `cannot ${MISSING_ABILITY[group]}`))
	const work = [...new Set(missing.map((group) => WORK_KIND[group]))].join(" or ")

	let wayOut: string
	if (canDelegate && canSwitch) {
		wayOut = `When the work needs ${work}, delegate it with new_task to a mode that has those tools${exampleHint}, or switch with switch_mode.`
	} else if (canDelegate) {
		wayOut = `When the work needs ${work}, delegate it with new_task to a mode that has those tools${exampleHint}.`
	} else if (canSwitch) {
		wayOut = `When the work needs ${work}, switch with switch_mode to a mode that has those tools${exampleHint}.`
	} else {
		wayOut = `When the work needs ${work}, say in your result that this mode cannot do it.`
	}

	return `====

TOOLS IN THIS MODE

This mode ${abilities}. Do not call those tools: a call to a tool that is not in your tool list is rejected and you get no result. ${wayOut}`
}
