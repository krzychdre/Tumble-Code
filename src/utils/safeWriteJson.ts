import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import * as lockfile from "proper-lockfile"
import { JsonStreamStringify } from "json-stream-stringify"

/**
 * Options for safeWriteJson function
 */
export interface SafeWriteJsonOptions {
	/**
	 * Whether to pretty-print the JSON output with indentation.
	 * When true, uses tab characters for indentation.
	 * When false or undefined, outputs compact JSON.
	 * @default false
	 */
	prettyPrint?: boolean
}

/** An atomic writer bound to one destination for the lifetime of a locked transaction. */
export type LockedJsonWriter = (data: any, options?: SafeWriteJsonOptions) => Promise<void>

const LOCK_OPTIONS = {
	stale: 31000,
	update: 10000,
	realpath: false,
	retries: {
		retries: 5,
		factor: 2,
		minTimeout: 100,
		maxTimeout: 1000,
	},
} as const

async function getExistingFileMode(filePath: string): Promise<number | undefined> {
	try {
		return (await fs.stat(filePath)).mode & 0o7777
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined
		}
		throw error
	}
}

async function streamJsonToTemporaryFile(
	targetPath: string,
	data: any,
	prettyPrint: boolean | undefined,
	mode: number | undefined,
): Promise<void> {
	await _streamDataToFile(targetPath, data, prettyPrint, mode)
	if (mode !== undefined) {
		await fs.chmod(targetPath, mode)
	}
}

async function writeJsonAtomically(filePath: string, data: any, options?: SafeWriteJsonOptions): Promise<void> {
	const absoluteFilePath = path.resolve(filePath)
	const existingMode = await getExistingFileMode(absoluteFilePath)
	let tempPath = path.join(
		path.dirname(absoluteFilePath),
		`.${path.basename(absoluteFilePath)}.new_${Date.now()}_${Math.random().toString(36).substring(2)}.tmp`,
	)

	try {
		await streamJsonToTemporaryFile(tempPath, data, options?.prettyPrint, existingMode)
		await fs.rename(tempPath, absoluteFilePath)
		tempPath = ""
	} finally {
		if (tempPath) {
			await fs.unlink(tempPath).catch(() => {})
		}
	}
}

/**
 * Run a transaction while holding an inter-process lock at a stable target.
 *
 * The callback receives an atomic writer bound to `destinationPath`. The
 * writer cannot select another destination and rejects calls made after the
 * callback has finished. All writes started by the callback settle before the
 * lock is released, including writes the callback did not await itself.
 *
 * This gateway deliberately does not create the destination directory. A
 * transaction may therefore read or delete a missing destination without
 * creating it, and create the directory only if it decides to write.
 */
export async function withLockedJsonTransaction<T>(
	lockTargetPath: string,
	destinationPath: string,
	transaction: (writeJson: LockedJsonWriter) => Promise<T>,
): Promise<T> {
	const absoluteLockTargetPath = path.resolve(lockTargetPath)
	const absoluteDestinationPath = path.resolve(destinationPath)

	await fs.mkdir(path.dirname(absoluteLockTargetPath), { recursive: true })

	let releaseLock: (() => Promise<void>) | undefined
	try {
		releaseLock = await lockfile.lock(absoluteLockTargetPath, {
			...LOCK_OPTIONS,
			onCompromised: (error) => {
				throw error
			},
		})
	} catch (lockError) {
		console.error(`Failed to acquire lock for ${absoluteLockTargetPath}:`, lockError)
		throw lockError
	}

	let acceptsWrites = true
	const startedWrites: Promise<void>[] = []
	const writeJson: LockedJsonWriter = (data, options) => {
		if (!acceptsWrites) {
			return Promise.reject(new Error("Locked JSON writer cannot be used after its transaction callback"))
		}

		const write = writeJsonAtomically(absoluteDestinationPath, data, options)
		startedWrites.push(write)
		return write
	}

	let callbackResult: T | undefined
	let callbackError: unknown
	let callbackFailed = false
	try {
		try {
			callbackResult = await transaction(writeJson)
		} catch (error) {
			callbackFailed = true
			callbackError = error
		}
		acceptsWrites = false

		const writeResults = await Promise.allSettled(startedWrites)
		if (callbackFailed) {
			throw callbackError
		}
		const failedWrite = writeResults.find((result): result is PromiseRejectedResult => result.status === "rejected")
		if (failedWrite) {
			throw failedWrite.reason
		}

		return callbackResult as T
	} finally {
		acceptsWrites = false
		try {
			await releaseLock()
		} catch (unlockError) {
			console.error(`Failed to release lock for ${absoluteLockTargetPath}:`, unlockError)
		}
	}
}

/**
 * Safely writes JSON data to a file.
 * - Creates parent directories if they don't exist
 * - Uses 'proper-lockfile' for inter-process advisory locking to prevent concurrent writes to the same path.
 * - Writes to a temporary file first.
 * - If the target file exists, it's backed up before being replaced.
 * - Attempts to roll back and clean up in case of errors.
 * - Supports pretty-printing with indentation while maintaining streaming efficiency.
 *
 * @param {string} filePath - The absolute path to the target file.
 * @param {any} data - The data to serialize to JSON and write.
 * @param {SafeWriteJsonOptions} options - Optional configuration for JSON formatting.
 * @returns {Promise<void>}
 */

async function safeWriteJson(filePath: string, data: any, options?: SafeWriteJsonOptions): Promise<void> {
	const absoluteFilePath = path.resolve(filePath)

	// For directory creation
	const dirPath = path.dirname(absoluteFilePath)

	// Ensure directory structure exists with improved reliability
	try {
		// Create directory with recursive option
		await fs.mkdir(dirPath, { recursive: true })

		// Verify directory exists after creation attempt
		await fs.access(dirPath)
	} catch (dirError: any) {
		console.error(`Failed to create or access directory for ${absoluteFilePath}:`, dirError)
		throw dirError
	}

	try {
		await withLockedJsonTransaction(absoluteFilePath, absoluteFilePath, (writeJson) => writeJson(data, options))
	} catch (originalError) {
		console.error(`Operation failed for ${absoluteFilePath}: [Original Error Caught]`, originalError)
		throw originalError
	}
}

/**
 * Helper function to stream JSON data to a file.
 * @param targetPath The path to write the stream to.
 * @param data The data to stream.
 * @param prettyPrint Whether to format the JSON with indentation.
 * @returns Promise<void>
 */
async function _streamDataToFile(
	targetPath: string,
	data: any,
	prettyPrint = false,
	mode: number | undefined = undefined,
): Promise<void> {
	// Stream data to avoid high memory usage for large JSON objects.
	const fileWriteStream = fsSync.createWriteStream(targetPath, {
		encoding: "utf8",
		...(mode === undefined ? {} : { mode }),
	})

	// JsonStreamStringify traverses the object and streams tokens directly
	// The 'spaces' parameter adds indentation during streaming, not via a separate pass
	// Convert undefined to null for valid JSON serialization (undefined is not valid JSON)
	const stringifyStream = new JsonStreamStringify(
		data === undefined ? null : data,
		undefined, // replacer
		prettyPrint ? "\t" : undefined, // spaces for indentation
	)

	return new Promise<void>((resolve, reject) => {
		stringifyStream.on("error", reject)
		fileWriteStream.on("error", reject)
		fileWriteStream.on("finish", resolve)
		stringifyStream.pipe(fileWriteStream)
	})
}

export { safeWriteJson }
