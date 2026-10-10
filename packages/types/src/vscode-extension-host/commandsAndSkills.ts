/*
 * Extension host channel, commandsAndSkills domain: the webview requests handled by
 * src/core/webview/messageHandlers/commandsAndSkills.ts and the host to view
 * messages of the same domain.
 */

/** Slash commands, skills and custom tools. */
export type CommandsAndSkillsWebviewMessageType =
	| "refreshCustomTools"
	| "requestCommands"
	| "requestSkills"
	| "createSkill"
	| "deleteSkill"
	| "updateSkillModes"
	| "openSkillFile"

/** Slash command, skill and custom tool lists. */
export type CommandsAndSkillsExtensionMessageType = "commands" | "customToolsResult" | "skills"

/**
 * An entry of the chat "/" menu (the "commands" message). Either a built-in
 * command (source "built-in", e.g. /init) or a skill available in the current
 * mode (source "global" or "project", filePath = its SKILL.md). User-defined
 * command files are no longer supported.
 */
export interface Command {
	name: string
	source: "global" | "project" | "built-in"
	filePath?: string
	description?: string
	argumentHint?: string
}
