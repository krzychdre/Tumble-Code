import * as path from "path"

import {
	getAgentsDirectoriesForCwd,
	getAllRooDirectoriesForCwd,
	getGlobalAgentsDirectory,
	getGlobalRooDirectory,
	getProjectAgentsDirectoryForCwd,
	getProjectRooDirectoryForCwd,
	getRooDirectoriesForCwd,
} from "./index"

/**
 * One place that answers "which directories hold <kind>, in which order".
 *
 * Every list is ordered from LOWEST to HIGHEST precedence. What a caller does
 * with the order depends on the kind:
 *
 * | kind          | combined by  | order (lowest first)                                                            |
 * | ------------- | ------------ | ------------------------------------------------------------------------------- |
 * | `rules`       | concatenated | ~/.roo, <cwd>/.roo, then subfolder .roo directories alphabetically (opt-in)       |
 * | `agent-rules` | concatenated | <cwd>, then every subfolder that has a .roo directory (opt-in)                  |
 * | `commands`    | override     | built-in (not a directory), ~/.roo/commands, <cwd>/.roo/commands                  |
 * | `skills`      | override     | ~/.agents, <cwd>/.agents, ~/.roo, <cwd>/.roo (each: skills, then skills-<mode>)   |
 *
 * `rules` with a `mode` lists the `rules-<mode>` directories; the prompt puts
 * them before the generic rules. Skills add two rules on top of the directory
 * order (SkillsManager.getSkillsForMode): a project skill beats a global one,
 * and within one source a mode-specific skill beats a generic one.
 *
 * Custom tools (`tools`) and custom modes read `getRooDirectoriesForCwd`
 * directly: ~/.roo first, then <cwd>/.roo, the later one overriding.
 *
 * The expensive part, the workspace scan for subfolder .roo directories, is
 * memoized per working directory (see cache.ts). Mode-specific directory names
 * are derived from the cached list on every call, so the cache never holds a
 * mode and a mid-task mode switch resolves the new mode's directories.
 */

export type RooDirectoryKind = "rules" | "agent-rules" | "commands" | "skills"

export type RooDirectorySource = "global" | "project" | "subfolder"

export interface RooDirectory {
	path: string
	source: RooDirectorySource
	/** Set for mode-specific directories (rules-<mode>, skills-<mode>). */
	mode?: string
}

export interface RooDirectoryListOptions {
	kind: RooDirectoryKind
	/** `rules`: list the `rules-<mode>` directories of this mode instead of `rules`. */
	mode?: string
	/** `skills`: the mode slugs to list `skills-<mode>` directories for. */
	modes?: readonly string[]
	/** `rules` and `agent-rules`: include subfolder .roo directories (the enableSubfolderRules setting). */
	includeSubfolders?: boolean
}

export class RooDirectoryResolver {
	/**
	 * List the directories of one kind for a working directory, lowest
	 * precedence first. `cwd` may be empty only for `skills` (no workspace
	 * open), which then lists the global directories alone.
	 */
	static async list(cwd: string | undefined, options: RooDirectoryListOptions): Promise<RooDirectory[]> {
		switch (options.kind) {
			case "rules":
				return RooDirectoryResolver.rules(cwd ?? "", options)
			case "agent-rules":
				return RooDirectoryResolver.agentRules(cwd ?? "", options)
			case "commands":
				return [
					{ path: path.join(getGlobalRooDirectory(), "commands"), source: "global" },
					{ path: path.join(getProjectRooDirectoryForCwd(cwd ?? ""), "commands"), source: "project" },
				]
			case "skills":
				return RooDirectoryResolver.skills(cwd, options.modes ?? [])
		}
	}

	private static async rules(cwd: string, options: RooDirectoryListOptions): Promise<RooDirectory[]> {
		// Both helpers return [global, project, ...subfolders alphabetically].
		const rooDirs = options.includeSubfolders ? await getAllRooDirectoriesForCwd(cwd) : getRooDirectoriesForCwd(cwd)
		const leaf = options.mode ? `rules-${options.mode}` : "rules"

		return rooDirs.map((dir, index) => ({
			path: path.join(dir, leaf),
			source: index === 0 ? "global" : index === 1 ? "project" : "subfolder",
			...(options.mode ? { mode: options.mode } : {}),
		}))
	}

	private static async agentRules(cwd: string, options: RooDirectoryListOptions): Promise<RooDirectory[]> {
		// getAgentsDirectoriesForCwd returns [cwd, ...parents of subfolder .roo directories].
		const dirs = options.includeSubfolders ? await getAgentsDirectoriesForCwd(cwd) : [cwd]
		return dirs.map((dir, index) => ({ path: dir, source: index === 0 ? "project" : "subfolder" }))
	}

	private static skills(cwd: string | undefined, modes: readonly string[]): RooDirectory[] {
		const dirs: RooDirectory[] = []
		const add = (base: string, source: RooDirectorySource) => {
			dirs.push({ path: path.join(base, "skills"), source })
			for (const mode of modes) {
				dirs.push({ path: path.join(base, `skills-${mode}`), source, mode })
			}
		}

		// Within one source a later directory replaces an earlier one's skill of
		// the same name and mode, so .roo wins over the cross-tool .agents.
		add(getGlobalAgentsDirectory(), "global")
		if (cwd) add(getProjectAgentsDirectoryForCwd(cwd), "project")
		add(getGlobalRooDirectory(), "global")
		if (cwd) add(getProjectRooDirectoryForCwd(cwd), "project")

		return dirs
	}
}
