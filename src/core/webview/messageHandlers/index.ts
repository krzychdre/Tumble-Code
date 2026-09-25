import { cloudAuthHandlers } from "./cloudAuth"
import { codeIndexHandlers } from "./codeIndex"
import { commandsAndSkillsHandlers } from "./commandsAndSkills"
import { customModesHandlers } from "./customModes"
import { debugHandlers } from "./debug"
import { enhanceAndSearchHandlers } from "./enhanceAndSearch"
import { filesAndCheckpointsHandlers } from "./filesAndCheckpoints"
import { marketplaceHandlers } from "./marketplace"
import { mcpHandlers } from "./mcp"
import { messageEditsHandlers } from "./messageEdits"
import { promptsAndModesHandlers } from "./promptsAndModes"
import { providerProfilesHandlers } from "./providerProfiles"
import { settingsHandlers } from "./settings"
import { subagentsHandlers } from "./subagents"
import { taskLifecycleHandlers } from "./taskLifecycle"
import { worktreesHandlers } from "./worktrees"
import type { MessageHandlerMap } from "./types"

/**
 * The domain modules, each owning a disjoint set of message types. To add a
 * webview message, add its handler to the module of its domain (or a new
 * module listed here); the registry spec fails if two modules claim a type.
 */
export const messageHandlerGroups: Readonly<Record<string, MessageHandlerMap>> = {
	taskLifecycle: taskLifecycleHandlers,
	messageEdits: messageEditsHandlers,
	settings: settingsHandlers,
	debug: debugHandlers,
	codeIndex: codeIndexHandlers,
	customModes: customModesHandlers,
	worktrees: worktreesHandlers,
	commandsAndSkills: commandsAndSkillsHandlers,
	cloudAuth: cloudAuthHandlers,
	enhanceAndSearch: enhanceAndSearchHandlers,
	providerProfiles: providerProfilesHandlers,
	marketplace: marketplaceHandlers,
	mcp: mcpHandlers,
	promptsAndModes: promptsAndModesHandlers,
	filesAndCheckpoints: filesAndCheckpointsHandlers,
	subagents: subagentsHandlers,
}

/** Message type to handler, assembled once from the domain modules. */
export const messageHandlers: MessageHandlerMap = Object.assign({}, ...Object.values(messageHandlerGroups))

export { createHandlerContext, type HandlerContext } from "./context"
export type { MessageHandler, MessageHandlerMap } from "./types"
