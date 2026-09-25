import type { GroupEntry, ToolGroup } from "@roo-code/types"

import { TOOL_GROUPS } from "@roo/tools"

/** The tool groups a mode can turn on or off (the always-available ones are not listed). */
export const availableGroups = (Object.keys(TOOL_GROUPS) as ToolGroup[]).filter(
	(group) => !TOOL_GROUPS[group].alwaysAvailable,
)

/** The group name of an entry, whether it is a plain name or a `[name, options]` tuple. */
export function getGroupName(group: GroupEntry): ToolGroup {
	return Array.isArray(group) ? group[0] : group
}
