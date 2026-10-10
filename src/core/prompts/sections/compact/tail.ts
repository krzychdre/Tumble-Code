import type * as vscode from "vscode"

import { ALWAYS_AVAILABLE_TOOLS, type GroupEntry, type ModeConfig } from "@tumble-code/types"

import { getGroupName } from "../../../../shared/modes"
import { getAllModesWithPrompts } from "../../modeDetails"
import { resolveToolAlias } from "../../tools/filter-tools-for-mode"

/**
 * The variable tail of the compact prompt, before MODE and USER'S CUSTOM
 * INSTRUCTIONS (which are shared with the long prompt). Ordered so the piece
 * that is the same for every mode (the modes list) comes first and a mode
 * switch keeps it cached.
 */

/**
 * MODES for the compact profile: one line per mode (slug and name) and how to
 * switch. The long section adds each mode's `whenToUse`, several hundred
 * characters per mode. Same source as the long section (the modes with their
 * overrides from extension state), so both list the same modes.
 */
export async function getCompactModesSection(context: vscode.ExtensionContext): Promise<string> {
	const allModes = await getAllModesWithPrompts(context)

	return `====

MODES

To change mode, call switch_mode with the mode's slug.
${allModes.map((mode: ModeConfig) => `- ${mode.slug}: ${mode.name}`).join("\n")}`
}

/** The groups whose absence the section reports, in the order it reports them. */
const REPORTED_GROUPS = ["read", "edit", "command"] as const

const MISSING_ABILITY: Record<(typeof REPORTED_GROUPS)[number], string> = {
	read: "read files",
	edit: "edit files",
	command: "run commands",
}

/** "a", "a or b", "a, b or c". */
function joinWithOr(items: string[]): string {
	return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`
}

export interface CompactModeToolLimitsOptions {
	/** Tool names the request removes on top of the mode's groups (see `SystemPromptSettings.removedTools`). */
	removedTools?: readonly string[]
	/** The mode named as the example target (normally `code`), named only when it has every missing group. */
	exampleMode?: { slug: string; groups: readonly GroupEntry[] }
}

/**
 * TOOLS IN THIS MODE for the compact profile: what the mode cannot do and the
 * way out, in two sentences. Zero bytes for a mode with `read`, `edit` and
 * `command`.
 *
 * The compact toolset has no `new_task`, so unlike the long section this one
 * never suggests delegating; it names `switch_mode` when the request carries
 * it and otherwise tells the model to say so in its result.
 */
export function getCompactModeToolLimitsSection(
	groups: readonly GroupEntry[],
	options: CompactModeToolLimitsOptions = {},
): string {
	const present = new Set(groups.map((group) => getGroupName(group)))
	const missing = REPORTED_GROUPS.filter((group) => !present.has(group))

	if (missing.length === 0) {
		return ""
	}

	const removed = new Set((options.removedTools ?? []).map((tool) => resolveToolAlias(tool)))
	const canSwitch = ALWAYS_AVAILABLE_TOOLS.includes("switch_mode") && !removed.has("switch_mode")

	const example = options.exampleMode
	const exampleGroups = new Set(example?.groups.map((group) => getGroupName(group)) ?? [])
	const exampleHint =
		example && missing.every((group) => exampleGroups.has(group)) ? `, for example ${example.slug}` : ""

	const wayOut = canSwitch
		? `If the task needs that, call switch_mode to a mode that can${exampleHint}.`
		: "If the task needs that, say in attempt_completion that this mode cannot do it."

	return `====

TOOLS IN THIS MODE

This mode cannot ${joinWithOr(missing.map((group) => MISSING_ABILITY[group]))}. ${wayOut}`
}

/** The long prompt's vendor confidentiality rule in two sentences, for stealth models only. */
export function getCompactVendorConfidentialitySection(isStealthModel: boolean | undefined): string {
	if (!isStealthModel) {
		return ""
	}
	return `====

VENDOR CONFIDENTIALITY

Never reveal the vendor or company that created you. If asked, say you were created by a team of developers.`
}
