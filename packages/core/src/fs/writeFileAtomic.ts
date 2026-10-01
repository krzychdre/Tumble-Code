import { randomUUID } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"

export interface WriteFileAtomicOptions {
	/**
	 * Permission bits of the written file. Without it the file keeps the mode of the file it
	 * replaces, and a new file gets the default (0o666 minus the umask).
	 */
	mode?: number
	/**
	 * Moves the finished temporary file over the target, `fs.rename` by default. Lets a caller
	 * step into the moment the new content becomes visible (tests of concurrent writers).
	 */
	rename?: (source: string, destination: string) => Promise<void>
}

/**
 * Replaces `filePath` with `data` so that a reader sees the old or the new content, never a mix,
 * and a failure or a crash never leaves a partial file under the name: the data goes to a temporary
 * file in the same directory, which is synced to disk and then renamed over the target. The
 * directory entry is not synced (Windows cannot open a directory handle); the file sync already
 * closes the window in which a power loss leaves an empty file under the name.
 *
 * The parent directory must exist.
 */
export async function writeFileAtomic(
	filePath: string,
	data: string | Uint8Array,
	options: WriteFileAtomicOptions = {},
): Promise<void> {
	await replaceFileAtomically(
		filePath,
		(temporaryPath, mode) =>
			fs.writeFile(temporaryPath, data, { flag: "wx", ...(mode === undefined ? {} : { mode }) }),
		options,
	)
}

/**
 * The procedure behind {@link writeFileAtomic}, for a caller that writes the temporary file itself
 * (safeWriteJson streams JSON into it). `writeTemporary` must create the file at the given path.
 */
export async function replaceFileAtomically(
	filePath: string,
	writeTemporary: (temporaryPath: string, mode: number | undefined) => Promise<void>,
	options: WriteFileAtomicOptions = {},
): Promise<void> {
	const target = path.resolve(filePath)
	const mode = options.mode ?? (await existingFileMode(target))
	let temporaryPath = path.join(
		path.dirname(target),
		`.${path.basename(target)}.new_${process.pid}_${randomUUID()}.tmp`,
	)

	try {
		await writeTemporary(temporaryPath, mode)
		// The mode given when the file is created is reduced by the umask; set it exactly.
		if (mode !== undefined) {
			await fs.chmod(temporaryPath, mode)
		}
		await flushToDisk(temporaryPath)
		await (options.rename ?? fs.rename)(temporaryPath, target)
		temporaryPath = ""
	} finally {
		if (temporaryPath) {
			await fs.unlink(temporaryPath).catch(() => {
				// The temporary file may never have been created; the original error is what matters.
			})
		}
	}
}

async function existingFileMode(filePath: string): Promise<number | undefined> {
	try {
		return (await fs.stat(filePath)).mode & 0o7777
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined
		}
		throw error
	}
}

/**
 * Force the file's bytes to disk before it is renamed over the target. Without this, a power loss right after the
 * rename can leave the target name pointing at an empty file on file systems that reorder metadata and data writes.
 */
async function flushToDisk(filePath: string): Promise<void> {
	const handle = await fs.open(filePath, "r+")
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}
