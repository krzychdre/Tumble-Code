import * as fs from "fs/promises"
import * as path from "path"

import { logger } from "../../utils/logging"

import { getCheckpointsRoot } from "./paths"

/**
 * Moves each task's shadow git repository from `<globalStorage>/tasks/<taskId>/checkpoints`
 * to `~/.roo/checkpoints/<taskId>`.
 *
 * Checkpoints used to live inside the extension's data folder, which VS Code walks
 * recursively to show the extension's size. One repository per task made that folder
 * hundreds of thousands of files, so opening the extension page froze the editor.
 *
 * The pass is idempotent: a task that already has a directory in the new root is left
 * alone, so it can run on every activation.
 */
export async function migrateCheckpointsOutOfGlobalStorage(globalStorageDir: string): Promise<number> {
	const tasksDir = path.join(globalStorageDir, "tasks")
	const root = getCheckpointsRoot()

	let taskIds: string[]

	try {
		taskIds = await fs.readdir(tasksDir)
	} catch {
		// No task history yet.
		return 0
	}

	let moved = 0

	for (const taskId of taskIds) {
		const from = path.join(tasksDir, taskId, "checkpoints")
		const to = path.join(root, taskId)

		const source = await fs.stat(from).catch(() => undefined)

		if (!source?.isDirectory()) {
			continue
		}

		if (
			await fs.stat(to).then(
				() => true,
				() => false,
			)
		) {
			continue
		}

		await fs.mkdir(root, { recursive: true })

		try {
			await fs.rename(from, to)
		} catch (error) {
			// `customStoragePath` can put globalStorage on another filesystem, where
			// rename fails with EXDEV and the data has to be copied instead.
			logger.info(
				`[migrateCheckpoints] rename failed for ${taskId}, copying instead: ${error instanceof Error ? error.message : String(error)}`,
			)
			await fs.cp(from, to, { recursive: true })
			await fs.rm(from, { recursive: true, force: true })
		}

		moved++
	}

	if (moved > 0) {
		logger.info(`[migrateCheckpoints] moved checkpoints of ${moved} task(s) to ${root}`)
	}

	return moved
}
