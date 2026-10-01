import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as yaml from "yaml"
import type { MarketplaceItem, MarketplaceItemType, InstallMarketplaceItemOptions, McpParameter } from "@roo-code/types"
import { GlobalFileNames } from "../../shared/globalFileNames"
import { ensureSettingsDirectoryExists } from "../../utils/globalContext"
import { getGlobalMcpSettingsPath } from "../mcp/mcpSettingsPath"
import { McpConfigStore } from "../mcp/McpConfigStore"
import type { CustomModesManager } from "../../core/config/CustomModesManager"

export interface InstallOptions extends InstallMarketplaceItemOptions {
	target: "project" | "global"
	selectedIndex?: number // Which installation method to use (for array content)
}

export class SimpleInstaller {
	/**
	 * Reads and writes the MCP settings files. It is not McpHub's store on purpose: the hub's
	 * write guard would hide this write from its file watcher, and the watcher is what
	 * connects a newly installed server.
	 */
	private readonly mcpConfigStore: McpConfigStore

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly customModesManager?: CustomModesManager,
	) {
		this.mcpConfigStore = new McpConfigStore({
			settingsDirectory: () => ensureSettingsDirectoryExists(context),
			workspacePath: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
		})
	}

	async installItem(item: MarketplaceItem, options: InstallOptions): Promise<{ filePath: string; line?: number }> {
		const { target } = options

		switch (item.type) {
			case "mode":
				return await this.installMode(item, target)
			case "mcp":
				return await this.installMcp(item, target, options)
			default: {
				const unsupported: never = item
				throw new Error(`Unsupported item type: ${(unsupported as { type?: unknown }).type}`)
			}
		}
	}

	private async installMode(
		item: MarketplaceItem,
		target: "project" | "global",
	): Promise<{ filePath: string; line?: number }> {
		if (!item.content) {
			throw new Error("Mode item missing content")
		}

		// Modes should always have string content, not array
		if (Array.isArray(item.content)) {
			throw new Error("Mode content should not be an array")
		}

		// Modes are written by CustomModesManager: its write queue keeps two writers
		// from losing each other's update, and it refreshes the mode list afterwards.
		if (!this.customModesManager) {
			throw new Error("CustomModesManager is not available")
		}

		// Transform marketplace content to import format (wrap in customModes array)
		const modeData = yaml.parse(item.content)
		const importYaml = yaml.stringify({ customModes: [modeData] })

		const result = await this.customModesManager.importModeWithRules(importYaml, target)

		if (!result.success) {
			throw new Error(result.error || "Failed to import mode")
		}

		// Return the file path and line number for VS Code to open
		const filePath = await this.getModeFilePath(target)

		// Try to find the line number where the mode was added
		let line: number | undefined
		try {
			const fileContent = await fs.readFile(filePath, "utf-8")
			const lines = fileContent.split("\n")

			// Find the line containing the slug of the added mode
			if (modeData?.slug) {
				const slugLineIndex = lines.findIndex(
					(l) => l.includes(`slug: ${modeData.slug}`) || l.includes(`slug: "${modeData.slug}"`),
				)
				if (slugLineIndex >= 0) {
					line = slugLineIndex + 1 // Convert to 1-based line number
				}
			}
		} catch (error) {
			// If we can't find the line number, that's okay
		}

		return { filePath, line }
	}

	private async installMcp(
		item: MarketplaceItem,
		target: "project" | "global",
		options?: InstallOptions,
	): Promise<{ filePath: string; line?: number }> {
		if (!item.content) {
			throw new Error("MCP item missing content")
		}

		// Get the content to use
		let contentToUse: string
		if (Array.isArray(item.content)) {
			// Array of McpInstallationMethod objects
			const index = options?.selectedIndex ?? 0
			const method = item.content[index] || item.content[0]
			contentToUse = method.content
		} else {
			contentToUse = item.content
		}

		// Get method-specific parameters if using array content
		let methodParameters: McpParameter[] = []
		if (Array.isArray(item.content)) {
			const index = options?.selectedIndex ?? 0
			const method = item.content[index] || item.content[0]
			methodParameters = method.parameters || []
		}

		// Merge parameters (method-specific override global)
		const itemParameters = item.type === "mcp" ? item.parameters || [] : []
		const allParameters = [...itemParameters, ...methodParameters]
		const uniqueParameters = Array.from(new Map(allParameters.map((p) => [p.key, p])).values())

		// Replace parameters if provided
		if (options?.parameters && uniqueParameters.length > 0) {
			for (const param of uniqueParameters) {
				const value = options.parameters[param.key]
				if (value !== undefined) {
					contentToUse = contentToUse.replace(new RegExp(`{{${param.key}}}`, "g"), String(value))
				}
			}
		}

		// Handle _selectedIndex from parameters if provided
		if (options?.parameters?._selectedIndex !== undefined && Array.isArray(item.content)) {
			const index = options.parameters._selectedIndex
			if (index >= 0 && index < item.content.length) {
				// Array of McpInstallationMethod objects
				const method = item.content[index]
				contentToUse = method.content
				methodParameters = method.parameters || []

				// Re-merge parameters with the newly selected method
				const itemParametersForNewMethod = item.type === "mcp" ? item.parameters || [] : []
				const allParametersForNewMethod = [...itemParametersForNewMethod, ...methodParameters]
				const uniqueParametersForNewMethod = Array.from(
					new Map(allParametersForNewMethod.map((p) => [p.key, p])).values(),
				)

				// Re-apply parameter replacements to the newly selected content
				for (const param of uniqueParametersForNewMethod) {
					const value = options.parameters[param.key]
					if (value !== undefined) {
						contentToUse = contentToUse.replace(new RegExp(`{{${param.key}}}`, "g"), String(value))
					}
				}
			}
		}

		const filePath = await this.getMcpFilePath(target)
		const mcpData = JSON.parse(contentToUse)

		const existingData = await this.readMcpFileForUpdate(filePath, target, "install")

		// Use the item id as the server name
		const serverName = item.id

		// Add or update the single server
		existingData.mcpServers[serverName] = mcpData

		// McpConfigStore writes atomically, so a crash mid-write cannot leave a truncated file.
		await this.mcpConfigStore.write(filePath, existingData)
		const jsonContent = JSON.stringify(existingData, null, "\t")

		// Calculate approximate line number where the new server was added
		let line: number | undefined
		if (serverName) {
			const lines = jsonContent.split("\n")
			// Find the line containing the server name
			const serverLineIndex = lines.findIndex((l) => l.includes(`"${serverName}"`))
			if (serverLineIndex >= 0) {
				line = serverLineIndex + 1 // Convert to 1-based line number
			}
		}

		return { filePath, line }
	}

	async removeItem(item: MarketplaceItem, options: InstallOptions): Promise<void> {
		const { target } = options

		switch (item.type) {
			case "mode":
				await this.removeMode(item, target)
				break
			case "mcp":
				await this.removeMcp(item, target)
				break
			default: {
				const unsupported: never = item
				throw new Error(`Unsupported item type: ${(unsupported as { type?: unknown }).type}`)
			}
		}
	}

	private async removeMode(item: MarketplaceItem, target: "project" | "global"): Promise<void> {
		if (!this.customModesManager) {
			throw new Error("CustomModesManager is not available")
		}

		// Parse the item content to get the slug
		let content: string
		if (Array.isArray(item.content)) {
			// Array of McpInstallationMethod objects - use first method
			content = item.content[0].content
		} else {
			content = item.content || ""
		}

		let modeSlug: string
		try {
			const modeData = yaml.parse(content)
			modeSlug = modeData.slug
		} catch (error) {
			throw new Error("Invalid mode content: unable to parse YAML")
		}

		if (!modeSlug) {
			throw new Error("Mode missing slug identifier")
		}

		// Get the current modes to determine the source
		const modes = await this.customModesManager.getCustomModes()
		const mode = modes.find((m) => m.slug === modeSlug)

		// Use CustomModesManager to delete the mode configuration
		// This also handles rules folder deletion
		await this.customModesManager.deleteCustomMode(modeSlug, true)
	}

	private async removeMcp(item: MarketplaceItem, target: "project" | "global"): Promise<void> {
		const filePath = await this.getMcpFilePath(target)
		const existingData = await this.readMcpFileForUpdate(filePath, target, "remove")
		if (!(item.id in existingData.mcpServers)) {
			return
		}
		delete existingData.mcpServers[item.id]
		await this.mcpConfigStore.write(filePath, existingData)
	}

	/**
	 * Reads an MCP settings file for an edit: an empty server list when the file is missing,
	 * an error when it holds invalid JSON (so it is not overwritten with only the new entry).
	 */
	private async readMcpFileForUpdate(
		filePath: string,
		target: "project" | "global",
		action: "install" | "remove",
	): Promise<{ mcpServers: Record<string, unknown>; [key: string]: unknown }> {
		let data: any
		try {
			data = await this.mcpConfigStore.readFile(filePath)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return { mcpServers: {} }
			}
			if (error instanceof SyntaxError) {
				const fileName = target === "project" ? ".roo/mcp.json" : "mcp-settings.json"
				const fix = action === "install" ? "installing new servers" : "removing servers"
				throw new Error(
					`Cannot ${action} MCP server: The ${fileName} file contains invalid JSON. ` +
						`Please fix the syntax errors in the file before ${fix}.`,
				)
			}
			throw error
		}
		const config = data && typeof data === "object" ? data : {}
		if (!config.mcpServers || typeof config.mcpServers !== "object") {
			config.mcpServers = {}
		}
		return config
	}

	private async getModeFilePath(target: "project" | "global"): Promise<string> {
		if (target === "project") {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
			if (!workspaceFolder) {
				throw new Error("No workspace folder found")
			}
			return path.join(workspaceFolder.uri.fsPath, ".roomodes")
		} else {
			const globalSettingsPath = await ensureSettingsDirectoryExists(this.context)
			return path.join(globalSettingsPath, GlobalFileNames.customModes)
		}
	}

	private async getMcpFilePath(target: "project" | "global"): Promise<string> {
		if (target === "project") {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
			if (!workspaceFolder) {
				throw new Error("No workspace folder found")
			}
			return path.join(workspaceFolder.uri.fsPath, ".roo", "mcp.json")
		} else {
			const globalSettingsPath = await ensureSettingsDirectoryExists(this.context)
			return getGlobalMcpSettingsPath(globalSettingsPath)
		}
	}
}
