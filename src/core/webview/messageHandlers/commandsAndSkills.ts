// Slash commands, skills and custom tools.

import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import type { Command as SlashCommand } from "@roo-code/types"
import { customToolRegistry } from "@roo-code/core"
import { t } from "../../../i18n"
import { defaultModeSlug } from "../../../shared/modes"
import { openFile } from "../../../integrations/misc/open-file"
import { getRooDirectoriesForCwd } from "../../../services/roo-config/index.js"
import { invalidateRooDirectoryCache } from "../../../services/roo-config/cache"
import {
	handleRequestSkills,
	handleCreateSkill,
	handleDeleteSkill,
	handleUpdateSkillModes,
	handleOpenSkillFile,
} from "../skillsMessageHandler"
import { type HandlerContext, serializeError, logAndToast } from "./context"
import type { MessageHandlerMap } from "./types"

const getCurrentMode = async (ctx: HandlerContext): Promise<string> => {
	const { provider } = ctx
	const currentTask = provider.getCurrentTask()

	if (currentTask) {
		try {
			return await currentTask.getTaskMode()
		} catch (error) {
			provider.log(`Error resolving current task mode for command discovery: ${serializeError(error)}`)
		}
	}

	try {
		const state = await provider.getState()
		if (typeof state.mode === "string" && state.mode.length > 0) {
			return state.mode
		}
	} catch (error) {
		provider.log(`Error resolving global mode for command discovery: ${serializeError(error)}`)
	}

	return defaultModeSlug
}

const getDiscoveredCommands = async (ctx: HandlerContext): Promise<SlashCommand[]> => {
	const { provider } = ctx
	const { getCommands } = await import("../../../services/command/commands")
	const commands = await getCommands(ctx.getCurrentCwd())

	const commandList: SlashCommand[] = commands.map((command) => ({
		name: command.name,
		source: command.source,
		filePath: command.filePath,
		description: command.description,
		argumentHint: command.argumentHint,
	}))

	const existingCommandNames = new Set(commandList.map((command) => command.name))
	const skillsManager = provider.getSkillsManager()

	if (!skillsManager) {
		return commandList
	}

	// Skill discovery is started without being awaited, so the map can still
	// be empty here. The CLI requests this list once, right after activation,
	// and caches it, so an unsynchronized read costs the user every skill in
	// the slash picker for the rest of the session.
	await skillsManager.whenReady()

	const currentMode = await getCurrentMode(ctx)
	const availableSkills = skillsManager.getSkillsForMode(currentMode)

	for (const skill of availableSkills) {
		if (existingCommandNames.has(skill.name)) {
			continue
		}

		existingCommandNames.add(skill.name)
		commandList.push({
			name: skill.name,
			source: skill.source,
			filePath: skill.path,
			description: skill.description,
		})
	}

	return commandList
}

export const commandsAndSkillsHandlers: MessageHandlerMap = {
	refreshCustomTools: async (ctx) => {
		const { provider, getCurrentCwd } = ctx
		try {
			const toolDirs = getRooDirectoriesForCwd(getCurrentCwd()).map((dir) => path.join(dir, "tools"))
			await customToolRegistry.loadFromDirectories(toolDirs)

			await provider.postMessageToWebview({
				type: "customToolsResult",
				tools: customToolRegistry.getAllSerialized(),
			})
		} catch (error) {
			await provider.postMessageToWebview({
				type: "customToolsResult",
				tools: [],
				error: error instanceof Error ? error.message : String(error),
			})
		}
	},

	requestCommands: async (ctx) => {
		const { provider } = ctx
		try {
			const commandList = await getDiscoveredCommands(ctx)
			await provider.postMessageToWebview({ type: "commands", commands: commandList })
		} catch (error) {
			provider.log(`Error fetching commands: ${serializeError(error)}`)
			await provider.postMessageToWebview({ type: "commands", commands: [] })
		}
	},

	requestSkills: async (ctx) => {
		const { provider } = ctx
		await handleRequestSkills(provider)
	},

	createSkill: async (ctx, message) => {
		const { provider } = ctx
		await handleCreateSkill(provider, message)
	},

	deleteSkill: async (ctx, message) => {
		const { provider } = ctx
		await handleDeleteSkill(provider, message)
	},

	updateSkillModes: async (ctx, message) => {
		const { provider } = ctx
		await handleUpdateSkillModes(provider, message)
	},

	openSkillFile: async (ctx, message) => {
		const { provider } = ctx
		await handleOpenSkillFile(provider, message)
	},

	openCommandFile: async (ctx, message) => {
		const { provider, getCurrentCwd } = ctx
		try {
			if (message.text) {
				const { getCommand } = await import("../../../services/command/commands")
				const command = await getCommand(getCurrentCwd(), message.text)

				if (command && command.filePath) {
					openFile(command.filePath)
				} else {
					vscode.window.showErrorMessage(t("common:errors.command_not_found", { name: message.text }))
				}
			}
		} catch (error) {
			logAndToast(ctx, "Error opening command file: ", error, "common:errors.open_command_file")
		}
	},

	deleteCommand: async (ctx, message) => {
		const { provider, getCurrentCwd } = ctx
		try {
			if (message.text && message.values?.source) {
				const { getCommand } = await import("../../../services/command/commands")
				const command = await getCommand(getCurrentCwd(), message.text)

				if (command && command.filePath) {
					// Delete the command file
					await fs.unlink(command.filePath)
					invalidateRooDirectoryCache("commands")
					provider.log(`Deleted command file: ${command.filePath}`)
				} else {
					vscode.window.showErrorMessage(t("common:errors.command_not_found", { name: message.text }))
				}
			}
		} catch (error) {
			logAndToast(ctx, "Error deleting command: ", error, "common:errors.delete_command")
		}
	},

	createCommand: async (ctx, message) => {
		const { provider, getCurrentCwd } = ctx
		try {
			const source = message.values?.source as "global" | "project"
			const fileName = message.text // Custom filename from user input

			if (!source) {
				provider.log("Missing source for createCommand")
				return
			}

			// Determine the commands directory based on source
			let commandsDir: string
			if (source === "global") {
				const globalConfigDir = path.join(os.homedir(), ".roo")
				commandsDir = path.join(globalConfigDir, "commands")
			} else {
				if (!vscode.workspace.workspaceFolders?.length) {
					vscode.window.showErrorMessage(t("common:errors.no_workspace"))
					return
				}
				// Project commands
				const workspaceRoot = getCurrentCwd()
				if (!workspaceRoot) {
					vscode.window.showErrorMessage(t("common:errors.no_workspace_for_project_command"))
					return
				}
				commandsDir = path.join(workspaceRoot, ".roo", "commands")
			}

			// Ensure the commands directory exists
			await fs.mkdir(commandsDir, { recursive: true })

			// Use provided filename or generate a unique one
			let commandName: string
			if (fileName && fileName.trim()) {
				let cleanFileName = fileName.trim()

				// Strip leading slash if present
				if (cleanFileName.startsWith("/")) {
					cleanFileName = cleanFileName.substring(1)
				}

				// Remove .md extension if present BEFORE slugification
				if (cleanFileName.toLowerCase().endsWith(".md")) {
					cleanFileName = cleanFileName.slice(0, -3)
				}

				// Slugify the command name: lowercase, replace spaces with dashes, remove special characters
				commandName = cleanFileName
					.toLowerCase()
					.replace(/\s+/g, "-") // Replace spaces with dashes
					.replace(/[^a-z0-9-]/g, "") // Remove special characters except dashes
					.replace(/-+/g, "-") // Replace multiple dashes with single dash
					.replace(/^-|-$/g, "") // Remove leading/trailing dashes

				// Ensure we have a valid command name
				if (!commandName || commandName.length === 0) {
					commandName = "new-command"
				}
			} else {
				// Generate a unique command name
				commandName = "new-command"
				let counter = 1
				let filePath = path.join(commandsDir, `${commandName}.md`)

				while (
					await fs
						.access(filePath)
						.then(() => true)
						.catch(() => false)
				) {
					commandName = `new-command-${counter}`
					filePath = path.join(commandsDir, `${commandName}.md`)
					counter++
				}
			}

			const filePath = path.join(commandsDir, `${commandName}.md`)

			// Check if file already exists
			if (
				await fs
					.access(filePath)
					.then(() => true)
					.catch(() => false)
			) {
				vscode.window.showErrorMessage(t("common:errors.command_already_exists", { commandName }))
				return
			}

			// Create the command file with template content
			const templateContent = t("common:errors.command_template_content")

			await fs.writeFile(filePath, templateContent, "utf8")
			// The list below must include the new file even if the watcher has not reported it yet.
			invalidateRooDirectoryCache("commands")
			provider.log(`Created new command file: ${filePath}`)

			// Open the new file in the editor
			openFile(filePath)

			// Refresh commands list
			const { getCommands } = await import("../../../services/command/commands")
			const commands = await getCommands(getCurrentCwd() || "")
			const commandList = commands.map((command) => ({
				name: command.name,
				source: command.source,
				filePath: command.filePath,
				description: command.description,
				argumentHint: command.argumentHint,
			}))
			await provider.postMessageToWebview({
				type: "commands",
				commands: commandList,
			})
		} catch (error) {
			logAndToast(ctx, "Error creating command: ", error, "common:errors.create_command_failed")
		}
	},
}
