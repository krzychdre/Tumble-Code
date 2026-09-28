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
	| "openCommandFile"
	| "deleteCommand"
	| "createCommand"

/** Slash command, skill and custom tool lists. */
export type CommandsAndSkillsExtensionMessageType = "commands" | "customToolsResult" | "skills"

export interface Command {
	name: string
	source: "global" | "project" | "built-in"
	filePath?: string
	description?: string
	argumentHint?: string
}
