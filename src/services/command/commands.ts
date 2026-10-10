/**
 * A slash command. Only the built-in commands (built-in-commands.ts, e.g.
 * /init) exist: user-defined command files (~/.roo/commands/*.md,
 * .roo/commands/*.md) are no longer read. Reusable user workflows are skills
 * (services/skills), which the chat "/" menu lists next to the built-ins.
 * Files left in those directories are ignored, never deleted.
 */
export interface Command {
	name: string
	content: string
	source: "built-in"
	filePath: string
	description?: string
	argumentHint?: string
	mode?: string
}
