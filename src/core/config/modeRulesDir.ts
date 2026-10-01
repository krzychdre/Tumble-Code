import { getWorkspacePath } from "../../utils/path"
import { RooDirectoryResolver } from "../../services/roo-config/RooDirectoryResolver"

/** The project file of custom modes, in the workspace root. */
export const ROOMODES_FILENAME = ".roomodes"

/**
 * The `rules-<slug>` directory of a mode: `~/.roo/rules-<slug>` for a global
 * mode, `<workspace>/.roo/rules-<slug>` for a project mode. Returns undefined
 * for a project mode when no workspace is open: there is no project directory
 * then, and a relative path would resolve against the extension host's cwd.
 */
export async function modeRulesDir(slug: string, source: "global" | "project"): Promise<string | undefined> {
	const workspacePath = getWorkspacePath()
	if (source === "project" && !workspacePath) {
		return undefined
	}

	const dirs = await RooDirectoryResolver.list(workspacePath, { kind: "rules", mode: slug })
	return dirs.find((dir) => dir.source === source)?.path
}
