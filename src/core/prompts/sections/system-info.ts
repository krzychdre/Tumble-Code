import os from "os"
import osName from "os-name"

import { getShell } from "../../../utils/shell"

// `osName()` is not a pure lookup on Windows: `windows-release` shells out
// synchronously (`wmic os get Caption`, and `powershell Get-CimInstance` on
// builds where wmic is gone) to tell desktop and Server editions apart. That
// blocks the extension host for seconds per call, and the answer cannot change
// while the process runs, so it is resolved once instead of on every system
// prompt build.
let cachedOsInfo: string | undefined

function resolveOsInfo(): string {
	if (cachedOsInfo === undefined) {
		// Try to get detailed OS name, fall back to basic info if it fails
		try {
			cachedOsInfo = osName()
		} catch (error) {
			// Fallback when os-name fails (e.g., PowerShell not available on Windows)
			const platform = os.platform()
			const release = os.release()
			cachedOsInfo = `${platform} ${release}`
		}
	}
	return cachedOsInfo
}

/** Drop the memoized OS name. For tests only. */
export function resetOsInfoCacheForTests(): void {
	cachedOsInfo = undefined
}

export function getSystemInfoSection(cwd: string): string {
	const osInfo = resolveOsInfo()

	// This section used to repeat the environment_details and list_files
	// paragraph of CAPABILITIES word for word, with the workspace path hardcoded
	// as '/test/path', so every prompt named a wrong directory and promised
	// list_files to modes that do not have it. CAPABILITIES carries that
	// paragraph (with the real path and phrased conditionally) once.
	const details = `====

SYSTEM INFORMATION

Operating System: ${osInfo}
Default Shell: ${getShell()}
Home Directory: ${os.homedir().toPosix()}
Current Workspace Directory: ${cwd.toPosix()}

The Current Workspace Directory is the active VS Code project directory, and is therefore the default directory for all tool operations. New terminals will be created in the current workspace directory, however if you change directories in a terminal it will then have a different working directory; changing directories in a terminal does not modify the workspace directory, because you do not have access to change the workspace directory.`

	return details
}
