import fs from "fs"
import path from "path"

import { readCliRuntimeEnv } from "@tumble-code/types"

/**
 * The CLI package root: the directory whose node_modules holds
 * @vscode/ripgrep, and the extension's `appRoot`. The release launcher sets
 * ROO_CLI_ROOT; otherwise walk up from `dirname` to the nearest package.json,
 * which works from dist/ (bundled) and from src/ (tsx dev) alike.
 */
export function getCliPackageRoot(dirname: string): string {
	const fromEnv = readCliRuntimeEnv(process.env).cliRoot

	if (fromEnv) {
		return fromEnv
	}

	let dir = dirname

	while (dir !== path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, "package.json"))) {
			return dir
		}

		dir = path.dirname(dir)
	}

	return path.resolve(dirname, "..")
}
