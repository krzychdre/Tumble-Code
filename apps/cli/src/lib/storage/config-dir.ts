import fs from "fs/promises"
import os from "os"
import path from "path"

const CONFIG_DIR = path.join(os.homedir(), ".roo")

export function getConfigDir(): string {
	return CONFIG_DIR
}

export async function ensureConfigDir(): Promise<void> {
	try {
		// Settings, history and MCP servers live here: only the user may list it.
		await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
	} catch (err) {
		// Directory may already exist, that's fine.
		const error = err as NodeJS.ErrnoException

		if (error.code !== "EEXIST") {
			throw err
		}
	}
}
