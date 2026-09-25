import path from "path"

import { useCallback, useEffect, useRef } from "react"

import type { McpServer, WebviewMessage } from "@roo-code/types"

import { takeNewMcpFailures } from "@/lib/utils/mcp-status.js"
import { getDefaultMcpSettingsPath } from "@/lib/storage/index.js"

import { figures } from "../figures.js"

export interface UseMcpPanelOptions {
	mcpServers: McpServer[]
	workspacePath: string
	/** The `--mcp-settings` override, if any. */
	mcpSettingsPath?: string
	sendToExtension: ((msg: WebviewMessage) => void) | null
	showInfo: (message: string, duration?: number) => void
	showWarning: (message: string, duration?: number) => void
}

export interface UseMcpPanelReturn {
	globalConfigPath: string
	projectConfigPath: string
	onRestart: (server: McpServer) => void
	onToggleDisabled: (server: McpServer) => void
	onReload: () => void
}

/**
 * Everything the `/mcp` panel needs, plus the one-time notice for a server
 * that failed to start.
 */
export function useMcpPanel({
	mcpServers,
	workspacePath,
	mcpSettingsPath,
	sendToExtension,
	showInfo,
	showWarning,
}: UseMcpPanelOptions): UseMcpPanelReturn {
	const globalConfigPath = mcpSettingsPath ?? getDefaultMcpSettingsPath()
	const projectConfigPath = path.join(workspacePath, ".roo", "mcp.json")

	// A server that fails to start used to fail silently: tell the user once
	// per failure and point at the panel, which holds the error.
	const reportedMcpFailures = useRef(new Set<string>())
	useEffect(() => {
		for (const server of takeNewMcpFailures(mcpServers, reportedMcpFailures.current)) {
			showWarning(`MCP server "${server.name}" failed to start ${figures.dot} /mcp for details`, 6000)
		}
	}, [mcpServers, showWarning])

	const onRestart = useCallback(
		(server: McpServer) => {
			sendToExtension?.({ type: "restartMcpServer", text: server.name, source: server.source ?? "global" })
			showInfo(`Restarting ${server.name}${figures.ellipsis}`, 2000)
		},
		[sendToExtension, showInfo],
	)

	const onToggleDisabled = useCallback(
		(server: McpServer) => {
			const disabled = !server.disabled
			sendToExtension?.({
				type: "toggleMcpServer",
				serverName: server.name,
				source: server.source ?? "global",
				disabled,
			})
			showInfo(`${disabled ? "Disabling" : "Enabling"} ${server.name}${figures.ellipsis}`, 2000)
		},
		[sendToExtension, showInfo],
	)

	const onReload = useCallback(() => {
		sendToExtension?.({ type: "refreshAllMcpServers" })
		showInfo(`Reloading MCP config files${figures.ellipsis}`, 2000)
	}, [sendToExtension, showInfo])

	return { globalConfigPath, projectConfigPath, onRestart, onToggleDisabled, onReload }
}
