import * as path from "path"

import { GlobalFileNames } from "../../shared/globalFileNames"

/**
 * Names the file that holds the global MCP servers when it is not the
 * extension's `<globalStorage>/settings/mcp_settings.json`. The CLI sets it in
 * its own process before activation (default `~/.roo/mcp.json`), because its
 * global storage is the shim's `~/.vscode-mock`, which nobody edits by hand and
 * which an `--ephemeral` run replaces with a temporary directory.
 */
const MCP_SETTINGS_PATH_ENV = "ROO_MCP_SETTINGS_PATH"

/**
 * The global MCP settings file: the override when one is set, otherwise
 * `mcp_settings.json` in the given settings directory.
 */
export function getGlobalMcpSettingsPath(settingsDirectory: string): string {
	const override = process.env[MCP_SETTINGS_PATH_ENV]?.trim()
	return override ? path.resolve(override) : path.join(settingsDirectory, GlobalFileNames.mcpSettings)
}
