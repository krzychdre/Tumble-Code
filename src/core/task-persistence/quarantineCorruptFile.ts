import * as fs from "fs/promises"
import { logger } from "../../utils/logging"

/**
 * Move a task file that cannot be read aside, so the next save does not overwrite it.
 *
 * The readers return `[]` for an unreadable file (their callers expect an array), and the task then saves its
 * new, nearly empty history over the old path. Renaming the damaged file first keeps the original bytes on disk
 * as `<name>.corrupt-<timestamp>` for manual recovery. Never throws: if the rename fails, the error is logged
 * and the caller continues as before.
 *
 * @returns the path the file was moved to, or `undefined` if the rename failed
 */
export async function quarantineCorruptFile(filePath: string, reason: string): Promise<string | undefined> {
	const quarantinePath = `${filePath}.corrupt-${Date.now()}`

	try {
		await fs.rename(filePath, quarantinePath)
		logger.error(`[quarantineCorruptFile] ${reason}. Moved ${filePath} to ${quarantinePath}`)
		return quarantinePath
	} catch (error) {
		logger.error(
			`[quarantineCorruptFile] ${reason}. Could not move ${filePath} aside: ${error instanceof Error ? error.message : String(error)}`,
		)
		return undefined
	}
}
