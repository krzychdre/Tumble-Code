// MCP servers: settings files, restarts, toggles and timeouts.

import * as path from "path"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import { t } from "../../../i18n"
import { openFile } from "../../../integrations/misc/open-file"
import { fileExistsAtPath } from "../../../utils/fs"
import { safeWriteJson } from "../../../utils/safeWriteJson"
import { logAndToast, serializeError } from "./context"
import type { MessageHandlerMap } from "./types"

export const mcpHandlers: MessageHandlerMap = {
	openMcpSettings: async (ctx) => {
		const { provider } = ctx
		const mcpSettingsFilePath = await provider.getMcpHub()?.getMcpSettingsFilePath()

		if (mcpSettingsFilePath) {
			openFile(mcpSettingsFilePath)
		}
	},

	openProjectMcpSettings: async (ctx) => {
		const { getCurrentCwd } = ctx
		if (!vscode.workspace.workspaceFolders?.length) {
			vscode.window.showErrorMessage(t("common:errors.no_workspace"))
			return
		}

		const workspaceFolder = getCurrentCwd()
		const rooDir = path.join(workspaceFolder, ".roo")
		const mcpPath = path.join(rooDir, "mcp.json")

		try {
			await fs.mkdir(rooDir, { recursive: true })
			const exists = await fileExistsAtPath(mcpPath)

			if (!exists) {
				await safeWriteJson(mcpPath, { mcpServers: {} }, { prettyPrint: true })
			}

			await openFile(mcpPath)
		} catch (error) {
			vscode.window.showErrorMessage(t("mcp:errors.create_json", { error: `${error}` }))
		}
	},

	deleteMcpServer: async (ctx, message) => {
		const { provider } = ctx
		if (!message.serverName) {
			return
		}

		try {
			provider.log(`Attempting to delete MCP server: ${message.serverName}`)
			await provider.getMcpHub()?.deleteServer(message.serverName, message.source as "global" | "project")
			provider.log(`Successfully deleted MCP server: ${message.serverName}`)

			// Refresh the webview state
			await provider.postStateToWebview()
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			provider.log(`Failed to delete MCP server: ${errorMessage}`)
			// Error messages are already handled by McpHub.deleteServer
		}
	},

	restartMcpServer: async (ctx, message) => {
		const { provider } = ctx
		try {
			await provider.getMcpHub()?.restartConnection(message.text!, message.source as "global" | "project")
		} catch (error) {
			provider.log(`Failed to retry connection for ${message.text}: ${serializeError(error)}`)
		}
	},

	toggleToolAlwaysAllow: async (ctx, message) => {
		const { provider } = ctx
		try {
			await provider
				.getMcpHub()
				?.toggleToolAlwaysAllow(
					message.serverName!,
					message.source as "global" | "project",
					message.toolName!,
					Boolean(message.alwaysAllow),
				)
		} catch (error) {
			provider.log(`Failed to toggle auto-approve for tool ${message.toolName}: ${serializeError(error)}`)
		}
	},

	toggleToolEnabledForPrompt: async (ctx, message) => {
		const { provider } = ctx
		try {
			await provider
				.getMcpHub()
				?.toggleToolEnabledForPrompt(
					message.serverName!,
					message.source as "global" | "project",
					message.toolName!,
					Boolean(message.isEnabled),
				)
		} catch (error) {
			provider.log(`Failed to toggle enabled for prompt for tool ${message.toolName}: ${serializeError(error)}`)
		}
	},

	toggleMcpServer: async (ctx, message) => {
		const { provider } = ctx
		try {
			await provider
				.getMcpHub()
				?.toggleServerDisabled(message.serverName!, message.disabled!, message.source as "global" | "project")
		} catch (error) {
			provider.log(`Failed to toggle MCP server ${message.serverName}: ${serializeError(error)}`)
		}
	},

	refreshAllMcpServers: async (ctx) => {
		const { provider } = ctx
		const mcpHub = provider.getMcpHub()

		if (mcpHub) {
			await mcpHub.refreshAllConnections()
		}
	},

	updateMcpTimeout: async (ctx, message) => {
		const { provider } = ctx
		if (message.serverName && typeof message.timeout === "number") {
			try {
				await provider
					.getMcpHub()
					?.updateServerTimeout(message.serverName, message.timeout, message.source as "global" | "project")
			} catch (error) {
				logAndToast(
					ctx,
					`Failed to update timeout for ${message.serverName}: `,
					error,
					"common:errors.update_server_timeout",
				)
			}
		}
	},
}
