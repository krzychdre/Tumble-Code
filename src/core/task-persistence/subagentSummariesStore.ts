import * as path from "path"
import * as fs from "fs/promises"

import type { ClineMessage, SubagentSummary } from "@tumble-code/types"

import { safeWriteJson } from "@tumble-code/core/fs"
import { getStorageBasePath, getTaskDirectoryPath } from "../../utils/storage"
import { fileExistsAtPath } from "../../utils/fs"

/**
 * Sidecar filename for persisted parallel-subagent summaries, written inside
 * the parent task's directory (`<storageBasePath>/tasks/<parentTaskId>/`).
 *
 * Keeping summaries in a sidecar (rather than on the shared `HistoryItem`)
 * prevents the shared `TaskHistoryStore` index from growing with per-child
 * payload, and keeps `HistoryItem` stable. The parent→child relation itself
 * is persisted on the `HistoryItem` via `parallelChildIds`; this file holds
 * the terminal summaries so rehydration can repopulate the panel without
 * re-reading every child's messages.
 */
export const SUBAGENTS_SIDECAR_FILENAME = "subagents.json"

/**
 * Resolve the absolute path of the subagent summaries sidecar for a parent
 * task. Ensures the parent task directory exists (mirrors
 * {@link getTaskDirectoryPath} semantics).
 *
 * Throws when `globalStoragePath` is empty: `path.join("", "tasks", id)` is a
 * *relative* path, so the sidecar would silently be created under the current
 * working directory instead of the extension's storage.
 */
export async function getSubagentSummariesFilePath(globalStoragePath: string, parentTaskId: string): Promise<string> {
	if (!globalStoragePath) {
		throw new Error("getSubagentSummariesFilePath: globalStoragePath is required")
	}
	const taskDir = await getTaskDirectoryPath(globalStoragePath, parentTaskId)
	return path.join(taskDir, SUBAGENTS_SIDECAR_FILENAME)
}

/**
 * Atomically persist the terminal summaries of a parent's most recent
 * parallel fan-out. Overwrites any previous sidecar for that parent —
 * `beginFanOut` semantics mean only the latest fan-out is relevant.
 *
 * Failures are caught by the caller (the tool logs a warning and continues);
 * this helper throws on I/O errors so the caller can decide policy.
 */
export async function saveSubagentSummaries(
	globalStoragePath: string,
	parentTaskId: string,
	summaries: SubagentSummary[],
): Promise<void> {
	const filePath = await getSubagentSummariesFilePath(globalStoragePath, parentTaskId)
	await safeWriteJson(filePath, summaries)
}

/**
 * Load the persisted subagent summaries for a parent task. Returns an empty
 * array when the sidecar is absent (pre-fix history item or never-fanned-out
 * task) or cannot be parsed (corrupt file — graceful degradation, never
 * throws). The caller MUST NOT treat a missing/corrupt sidecar as a corrupt
 * task.
 */
export async function loadSubagentSummaries(
	globalStoragePath: string,
	parentTaskId: string,
): Promise<SubagentSummary[]> {
	let filePath: string
	try {
		filePath = await getSubagentSummariesFilePath(globalStoragePath, parentTaskId)
	} catch {
		// Storage base path unavailable (e.g. VS Code config unreadable in
		// tests) — treat as "no sidecar".
		return []
	}
	if (!(await fileExistsAtPath(filePath))) {
		return []
	}
	try {
		const raw = await fs.readFile(filePath, "utf8")
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) {
			return []
		}
		// Minimal shape guard: keep only entries that look like summaries.
		// We don't run the full zod schema here (the sidecar is internal and
		// written by us); a loose guard is enough to skip corrupt entries
		// without throwing away the whole file.
		return parsed.filter(
			(entry: unknown): entry is SubagentSummary =>
				!!entry &&
				typeof entry === "object" &&
				typeof (entry as SubagentSummary).taskId === "string" &&
				typeof (entry as SubagentSummary).parentTaskId === "string",
		)
	} catch {
		return []
	}
}

/**
 * Directory inside the parent task's directory where older fan-outs kept one
 * message transcript per subagent (`<parentTaskId>/subagents/<childTaskId>.json`),
 * back when a completed subagent's own task directory was deleted. Only read
 * now, as the fallback for those runs.
 */
export const SUBAGENT_TRANSCRIPTS_DIRNAME = "subagents"

/**
 * Whether a subagent task id is safe to use as a file or directory name: no
 * path separator, no "..", no leading dot.
 */
export function isSafeSubagentTaskId(taskId: string): boolean {
	return !!taskId && path.basename(taskId) === taskId && !taskId.startsWith(".")
}

async function getSubagentTranscriptPath(
	globalStoragePath: string,
	parentTaskId: string,
	childTaskId: string,
): Promise<string> {
	if (!globalStoragePath) {
		throw new Error("getSubagentTranscriptPath: globalStoragePath is required")
	}
	// The id names a file: a value with a path separator or ".." must not
	// reach outside the transcripts directory.
	if (!isSafeSubagentTaskId(childTaskId)) {
		throw new Error(`getSubagentTranscriptPath: invalid subagent task id "${childTaskId}"`)
	}
	const basePath = await getStorageBasePath(globalStoragePath)
	return path.join(basePath, "tasks", parentTaskId, SUBAGENT_TRANSCRIPTS_DIRNAME, `${childTaskId}.json`)
}

/**
 * Load a subagent's transcript kept under its parent by older fan-outs.
 * Returns an empty array when there is none or it cannot be read; never throws.
 */
export async function loadSubagentTranscript(
	globalStoragePath: string,
	parentTaskId: string,
	childTaskId: string,
): Promise<ClineMessage[]> {
	try {
		const filePath = await getSubagentTranscriptPath(globalStoragePath, parentTaskId, childTaskId)
		if (!(await fileExistsAtPath(filePath))) {
			return []
		}
		const parsed = JSON.parse(await fs.readFile(filePath, "utf8"))
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}
