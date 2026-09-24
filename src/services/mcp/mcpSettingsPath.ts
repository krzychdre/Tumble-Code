import * as path from "path"

import { readCliRuntimeEnv } from "@roo-code/types"

import { GlobalFileNames } from "../../shared/globalFileNames"

/**
 * The global MCP settings file: the override when one is set, otherwise
 * `mcp_settings.json` in the given settings directory.
 *
 * The override is `ROO_MCP_SETTINGS_PATH` (see `CLI_RUNTIME_ENV` in
 * @roo-code/types). The CLI sets it in its own process before activation
 * (default `~/.roo/mcp.json`), because its global storage is the shim's
 * `~/.vscode-mock`, which nobody edits by hand and which an `--ephemeral` run
 * replaces with a temporary directory.
 */
export function getGlobalMcpSettingsPath(settingsDirectory: string): string {
	const override = readCliRuntimeEnv(process.env).mcpSettingsPath
	return override ? path.resolve(override) : path.join(settingsDirectory, GlobalFileNames.mcpSettings)
}
