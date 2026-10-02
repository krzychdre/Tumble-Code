import * as fs from "fs"
import * as path from "path"

import { writeFileAtomic } from "@tumble-code/core/fs"

import { getTaskDirectoryPath } from "../../utils/storage"
import { logger } from "../../utils/logging"

/**
 * Kinds of task artifact.
 *
 * - `cmd`: full output of an `execute_command` run (written by the
 *   `OutputInterceptor` while the command streams).
 * - `tool`: a tool result that exceeded the inline budget and was spilled by
 *   the tool-result spill policy.
 * - `prune`: a tool result moved to disk by the deterministic pruner.
 * - `fetch`: a full `web_fetch` payload.
 */
export const ARTIFACT_KINDS = ["cmd", "tool", "prune", "fetch"] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

/**
 * Directory (relative to the task directory) that holds artifacts of a kind.
 *
 * `cmd` artifacts keep their historical `command-output` directory so ids
 * quoted in old task histories still resolve, and so the existing orphan
 * cleanup (which matches artifact ids against message timestamps) keeps
 * working unchanged. Everything else lives under `artifacts`.
 */
const KIND_DIRECTORIES: Record<ArtifactKind, string> = {
	cmd: "command-output",
	tool: "artifacts",
	prune: "artifacts",
	fetch: "artifacts",
}

/** Every directory an artifact may live in, most specific first. */
export const ARTIFACT_DIRECTORIES: readonly string[] = ["artifacts", "command-output"]

/**
 * Result of persisting an artifact.
 *
 * `id` is the file name including the `.txt` suffix, exactly the string the
 * model passes back to `read_artifact` as `artifact_id`.
 */
export interface SavedArtifact {
	id: string
	bytes: number
	path: string
}

/** Matches a well-formed artifact id, e.g. `tool-1706119234567.txt`. */
const ARTIFACT_ID_PATTERN = new RegExp(`^(${ARTIFACT_KINDS.join("|")})-\\d+\\.txt$`)

/**
 * Builds the artifact file name for a kind and timestamp.
 *
 * Kept byte-compatible with the ids the `OutputInterceptor` has always minted
 * (`cmd-<executionId>.txt`) so references in old task histories keep working.
 */
export function artifactFileName(kind: ArtifactKind, timestamp: string | number): string {
	return `${kind}-${timestamp}.txt`
}

/**
 * Validates an artifact id: `<kind>-<digits>.txt` and nothing else.
 *
 * This is the path-traversal guard for `read_artifact`: ids are joined onto a
 * task directory, so anything with separators or dots must be rejected.
 */
export function isValidArtifactId(artifactId: string): boolean {
	return ARTIFACT_ID_PATTERN.test(artifactId)
}

/**
 * Returns the artifact kind encoded in an id, or `undefined` when the id is
 * not well-formed.
 */
export function artifactKindFromId(artifactId: string): ArtifactKind | undefined {
	if (!isValidArtifactId(artifactId)) {
		return undefined
	}
	return artifactId.slice(0, artifactId.indexOf("-")) as ArtifactKind
}

/**
 * Absolute directory that holds artifacts of `kind` for a task directory.
 */
export function artifactDirForKind(taskDir: string, kind: ArtifactKind): string {
	return path.join(taskDir, KIND_DIRECTORIES[kind])
}

/**
 * Candidate absolute paths for an artifact id inside a task directory, in
 * lookup order. Both directories are probed so an id minted by an older build
 * (or by a future kind remap) still resolves.
 */
export function artifactCandidatePaths(taskDir: string, artifactId: string): string[] {
	const kind = artifactKindFromId(artifactId)
	const preferred = kind ? KIND_DIRECTORIES[kind] : ARTIFACT_DIRECTORIES[0]
	const ordered = [preferred, ...ARTIFACT_DIRECTORIES.filter((dir) => dir !== preferred)]
	return ordered.map((dir) => path.join(taskDir, dir, artifactId))
}

/**
 * Upper bound on a single artifact.
 *
 * The write no longer blocks the extension host, but an unbounded artifact
 * would still cost memory and disk for a payload no model can read: a
 * pathological 100 MB MCP payload keeps the first `MAX_ARTIFACT_BYTES` and says
 * so at the end of the file.
 */
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024

/** Appended when an artifact hits `MAX_ARTIFACT_BYTES`. */
const TRUNCATION_NOTICE_PREFIX = "\n[Artifact truncated at 10 MB;"

/**
 * Caps an artifact payload at `MAX_ARTIFACT_BYTES`, appending a note that says
 * what was dropped. The note is written so a model reading the tail understands
 * it is looking at a truncated artifact and not at the end of the output.
 */
function capArtifactText(text: string): string {
	const bytes = Buffer.byteLength(text, "utf8")

	if (bytes <= MAX_ARTIFACT_BYTES) {
		return text
	}

	// Slice on the buffer, then drop a trailing partial character.
	const kept = Buffer.from(text, "utf8")
		.subarray(0, MAX_ARTIFACT_BYTES)
		.toString("utf8")
		.replace(/\uFFFD$/, "")
	const dropped = bytes - Buffer.byteLength(kept, "utf8")

	return `${kept}${TRUNCATION_NOTICE_PREFIX} ${dropped} bytes of the original output were dropped. Narrow the tool call (fewer files, a tighter pattern) if you need the missing part.]\n`
}

/**
 * Artifact paths a `save` in this process has claimed but not finished
 * writing. Module level, not per store: two stores for the same task directory
 * must not hand the same id to two concurrent writes either.
 */
const claimedPaths = new Set<string>()

/** Resolves to true when `filePath` exists, without blocking the event loop. */
async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.access(filePath)
		return true
	} catch {
		return false
	}
}

/**
 * ArtifactStore persists oversized text to a task-local file and hands back an
 * id the model can quote to `read_artifact`.
 *
 * The write is asynchronous and atomic: the text goes to a temporary file in
 * the same directory, and only a complete file is renamed to the artifact id.
 * A crash or an I/O error mid-write therefore never leaves a truncated file
 * under an id a model could read and mistake for the whole output. Callers that
 * put the id in front of a model (the spill policy, the pruner) do so only
 * after `save` resolves, so the id is never a promise the disk did not keep.
 *
 * @example
 * ```typescript
 * const store = await ArtifactStore.forTask(globalStoragePath, taskId)
 * const artifact = await store.save("tool", hugeSearchOutput)
 * // artifact.id === "tool-1706119234567.txt"
 * ```
 */
/** Cleanup is best effort: a file that cannot be deleted now is retried on the next cleanup. */
function logArtifactCleanupFailure(error: unknown): void {
	logger.debug(`[ArtifactStore] artifact not removed: ${String(error)}`)
}

export class ArtifactStore {
	/**
	 * @param taskDir - Absolute path of the task directory that owns the artifacts.
	 */
	constructor(private readonly taskDir: string) {}

	/**
	 * Creates a store for a task, ensuring the task directory exists.
	 */
	static async forTask(globalStoragePath: string, taskId: string): Promise<ArtifactStore> {
		const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
		return new ArtifactStore(taskDir)
	}

	/** Absolute path of the task directory backing this store. */
	getTaskDir(): string {
		return this.taskDir
	}

	/**
	 * Persists `text` as an artifact of `kind` and returns its id, size and path.
	 *
	 * Ids are `<kind>-<epoch-millis>.txt`. When two artifacts of the same kind
	 * are saved in the same millisecond the timestamp is advanced until a free
	 * name is found, so an id is never silently overwritten.
	 *
	 * Text above `MAX_ARTIFACT_BYTES` is truncated with a note appended.
	 *
	 * `bytes` reports what was written, which is what `read_artifact` will find.
	 *
	 * Rejects on I/O failure, and then nothing is left on disk: callers that
	 * must not turn a success into an error (the spill policy, the pruner) catch
	 * and fall back to keeping the text inline.
	 */
	async save(kind: ArtifactKind, text: string, now: number = Date.now()): Promise<SavedArtifact> {
		const dir = artifactDirForKind(this.taskDir, kind)
		const payload = capArtifactText(text)

		await fs.promises.mkdir(dir, { recursive: true })

		let timestamp = Math.max(0, Math.floor(now))
		let fileName = artifactFileName(kind, timestamp)
		let filePath = path.join(dir, fileName)

		// Collision safety: two tools can spill inside the same millisecond. The
		// claim is taken synchronously, before any await, so a concurrent save
		// in this process moves on to the next id instead of racing for this one.
		// The disk check covers ids written earlier (a resumed task, another
		// window).
		for (;;) {
			if (!claimedPaths.has(filePath)) {
				claimedPaths.add(filePath)
				if (!(await pathExists(filePath))) {
					break
				}
				claimedPaths.delete(filePath)
			}
			timestamp += 1
			fileName = artifactFileName(kind, timestamp)
			filePath = path.join(dir, fileName)
		}

		try {
			await writeFileAtomic(filePath, payload)
		} finally {
			claimedPaths.delete(filePath)
		}

		return { id: fileName, bytes: Buffer.byteLength(payload, "utf8"), path: filePath }
	}

	/**
	 * Opens a write stream for an artifact, creating the directory if needed.
	 *
	 * Used by the `OutputInterceptor`, which streams command output to disk as
	 * it arrives instead of buffering the whole thing in memory.
	 *
	 * @param artifactPath - Absolute path of the artifact file to open.
	 */
	static openWriteStream(artifactPath: string): fs.WriteStream {
		const dir = path.dirname(artifactPath)

		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}

		return fs.createWriteStream(artifactPath)
	}

	/**
	 * Removes every artifact file of the given kinds from a directory.
	 *
	 * @param storageDir - Directory containing artifact files.
	 * @param kinds - Artifact kinds to delete (defaults to all).
	 */
	static async cleanup(storageDir: string, kinds: readonly ArtifactKind[] = ARTIFACT_KINDS): Promise<void> {
		try {
			const files = await fs.promises.readdir(storageDir)
			for (const file of files) {
				if (kinds.some((kind) => file.startsWith(`${kind}-`))) {
					await fs.promises.unlink(path.join(storageDir, file)).catch(logArtifactCleanupFailure)
				}
			}
		} catch {
			// Directory doesn't exist, nothing to clean.
		}
	}

	/**
	 * Removes artifacts of a kind whose timestamp is NOT in `keepTimestamps`.
	 *
	 * Used for selective cleanup: artifacts still referenced by a message in the
	 * conversation are preserved, orphans are deleted.
	 */
	static async cleanupByIds(
		storageDir: string,
		keepTimestamps: Set<string>,
		kind: ArtifactKind = "cmd",
	): Promise<void> {
		const pattern = new RegExp(`^${kind}-(\\d+)\\.txt$`)

		try {
			const files = await fs.promises.readdir(storageDir)
			for (const file of files) {
				const match = file.match(pattern)
				if (match && !keepTimestamps.has(match[1])) {
					await fs.promises.unlink(path.join(storageDir, file)).catch(logArtifactCleanupFailure)
				}
			}
		} catch {
			// Directory doesn't exist, nothing to clean.
		}
	}
}
