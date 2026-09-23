import os from "os"
import path from "path"

import { getConfigDir } from "./config-dir.js"

/**
 * The CLI's global MCP servers, the counterpart of the extension's
 * `mcp_settings.json`. It mirrors the project file (`<project>/.roo/mcp.json`)
 * one level up, in the user's `~/.roo`.
 */
export function getDefaultMcpSettingsPath(): string {
	return path.join(getConfigDir(), "mcp.json")
}

/**
 * The global MCP settings file for this run: `mcpSettingsPath` from
 * cli-settings.json when set (a leading `~` means the home directory, a
 * relative path is taken from ~/.roo), otherwise ~/.roo/mcp.json.
 */
export function resolveMcpSettingsPath(configured: string | undefined): string {
	const value = configured?.trim()

	if (!value) {
		return getDefaultMcpSettingsPath()
	}

	const expanded = /^~(?=$|[\\/])/.test(value) ? path.join(os.homedir(), value.slice(1)) : value
	return path.resolve(getConfigDir(), expanded)
}
