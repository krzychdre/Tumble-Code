import { getBuiltInCommands, getBuiltInCommand } from "./built-in-commands"

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
	/** Always "built-in" now; the wider type keeps the run_slash_command tool and its tests compiling. */
	source: "global" | "project" | "built-in"
	filePath: string
	description?: string
	argumentHint?: string
	mode?: string
}

/**
 * All slash commands. `cwd` is unused since custom command directories went
 * away; the parameter stays so existing callers keep compiling.
 */
export async function getCommands(_cwd: string): Promise<Command[]> {
	return getBuiltInCommands()
}

/** A slash command by name, or undefined. See getCommands for `cwd`. */
export async function getCommand(_cwd: string, name: string): Promise<Command | undefined> {
	return getBuiltInCommand(name)
}

/** Slash command names. See getCommands for `cwd`. */
export async function getCommandNames(_cwd: string): Promise<string[]> {
	return (await getBuiltInCommands()).map((command) => command.name)
}
