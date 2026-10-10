// Slash menu entries (built-in commands and skills), skills and custom tools.

import * as path from "path"
import type { Command as SlashCommand } from "@tumble-code/types"
import { customToolRegistry } from "@tumble-code/core"
import { defaultModeSlug } from "../../../shared/modes"
import { getRooDirectoriesForCwd } from "../../../services/roo-config/index.js"
import {
	handleRequestSkills,
	handleCreateSkill,
	handleDeleteSkill,
	handleUpdateSkillModes,
	handleOpenSkillFile,
} from "../skillsMessageHandler"
import { type HandlerContext, serializeError } from "./context"
import type { DomainHandlerMap } from "./types"
import { logger } from "../../../utils/logging"

const getCurrentMode = async (ctx: HandlerContext): Promise<string> => {
	const { provider } = ctx
	const currentTask = provider.getCurrentTask()

	if (currentTask) {
		try {
			return await currentTask.getTaskMode()
		} catch (error) {
			logger.warn(`Error resolving current task mode for command discovery: ${serializeError(error)}`)
		}
	}

	try {
		const state = await provider.getState()
		if (typeof state.mode === "string" && state.mode.length > 0) {
			return state.mode
		}
	} catch (error) {
		logger.warn(`Error resolving global mode for command discovery: ${serializeError(error)}`)
	}

	return defaultModeSlug
}

/**
 * The entries of the chat "/" menu: the built-in commands, then every skill
 * available in the current mode (SkillsManager.getSkillsForMode, the same
 * resolution the skill tool and the "/skill-name" expansion use). Skills keep
 * their "global" or "project" source; only built-in commands are "built-in".
 *
 * Name collisions: a built-in command wins over a skill of the same name, so
 * the skill is left out of the list. parseMentions (core/mentions) expands
 * "/name" with the same rule. Modes are listed by the webview from its own
 * mode list and are not part of this one.
 */
const getSlashCommandsAndSkills = async (ctx: HandlerContext): Promise<SlashCommand[]> => {
	const { provider } = ctx
	const { getBuiltInCommands } = await import("../../../services/command/built-in-commands")

	const commandList: SlashCommand[] = (await getBuiltInCommands()).map((command) => ({
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

export const commandsAndSkillsHandlers: DomainHandlerMap<"commandsAndSkills"> = {
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
			const commandList = await getSlashCommandsAndSkills(ctx)
			await provider.postMessageToWebview({ type: "commands", commands: commandList })
		} catch (error) {
			logger.error(`Error fetching commands: ${serializeError(error)}`)
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
}
