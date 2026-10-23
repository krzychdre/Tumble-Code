import path from "path"

import { readCliRuntimeEnv } from "@tumble-code/types"

/**
 * The ripgrep binary the CLI uses: the release launcher's ROO_RIPGREP_PATH,
 * else `rgPath` of @vscode/ripgrep, which resolves its per-platform package
 * (`@vscode/ripgrep-<platform>-<arch>/bin/rg`). The release does not install
 * @vscode/ripgrep, and the import throws on a platform without a package;
 * both give undefined.
 */
export async function resolveRipgrepPath(): Promise<string | undefined> {
	const override = readCliRuntimeEnv(process.env).ripgrepPath

	if (override && path.isAbsolute(override)) {
		return override
	}

	try {
		return (await import("@vscode/ripgrep")).rgPath
	} catch {
		return undefined
	}
}
