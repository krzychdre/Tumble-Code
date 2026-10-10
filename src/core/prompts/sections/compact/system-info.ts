import os from "os"

import { getShell } from "../../../../utils/shell"
import { getCommandChainOperator } from "../rules"
import { resolveOsInfo } from "../system-info"

/**
 * SYSTEM INFORMATION for the compact profile: the machine facts of the long
 * section (OS, shell, home, workspace) in two lines, plus the shell's command
 * chaining operator, which the long prompt states in RULES.
 *
 * Compact stable head: the inputs vary with the machine and the workspace,
 * never with the mode.
 */
export function getCompactSystemInfoSection(cwd: string): string {
	return `====

SYSTEM INFORMATION

OS: ${resolveOsInfo()}. Shell: ${getShell()}, chain commands with ${getCommandChainOperator()}. Home: ${os.homedir().toPosix()}.
Workspace directory: ${cwd.toPosix()}. It is the default directory for every tool and for new terminals.`
}
