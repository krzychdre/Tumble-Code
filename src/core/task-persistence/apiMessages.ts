import { safeWriteJson, withLockedJsonTransaction } from "@roo-code/core/fs"
import { perfCounters } from "../../utils/perfCounters"
import * as path from "path"
import * as fs from "fs/promises"

import { Anthropic } from "@anthropic-ai/sdk"

import { fileExistsAtPath } from "../../utils/fs"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { getTaskDirectoryPath } from "../../utils/storage"

import { quarantineCorruptFile } from "./quarantineCorruptFile"

export type ApiMessage = Anthropic.MessageParam & {
	ts?: number
	isSummary?: boolean
	id?: string
	// For reasoning items stored in API history
	type?: "reasoning"
	summary?: any[]
	encrypted_content?: string
	text?: string
	// For OpenRouter reasoning_details array format (used by Gemini 3, etc.)
	reasoning_details?: any[]
	// For DeepSeek/Z.ai interleaved thinking: reasoning_content that must be preserved during tool call sequences
	// See: https://api-docs.deepseek.com/guides/thinking_mode#tool-calls
	reasoning_content?: string
	// For non-destructive condense: unique identifier for summary messages
	condenseId?: string
	// For non-destructive condense: points to the condenseId of the summary that replaces this message
	// Messages with condenseParent are filtered out when sending to API if the summary exists
	condenseParent?: string
	// For non-destructive truncation: unique identifier for truncation marker messages
	truncationId?: string
	// For non-destructive truncation: points to the truncationId of the marker that hides this message
	// Messages with truncationParent are filtered out when sending to API if the marker exists
	truncationParent?: string
	// Identifies a message as a truncation boundary marker
	isTruncationMarker?: boolean
}

/** File name the Cline-era extension used for the API conversation history of a task. */
const LEGACY_API_MESSAGES_FILE = "claude_messages.json"

export async function readApiMessages({
	taskId,
	globalStoragePath,
}: {
	taskId: string
	globalStoragePath: string
}): Promise<ApiMessage[]> {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.apiConversationHistory)

	if (await fileExistsAtPath(filePath)) {
		return readCurrentApiMessages(taskId, filePath)
	}

	const oldPath = path.join(taskDir, LEGACY_API_MESSAGES_FILE)
	if (await fileExistsAtPath(oldPath)) {
		return migrateLegacyApiMessages(taskId, filePath, oldPath)
	}

	// A concurrent reader may have migrated the legacy file between the two checks above: it writes the new file
	// before it deletes the old one, so looking once more closes that window.
	if (await fileExistsAtPath(filePath)) {
		return readCurrentApiMessages(taskId, filePath)
	}

	// If we reach here, neither the new nor the old history file was found.
	console.error(
		`[Roo-Debug] readApiMessages: API conversation history file not found for taskId: ${taskId}. Expected at: ${filePath}`,
	)
	return []
}

async function readCurrentApiMessages(taskId: string, filePath: string): Promise<ApiMessage[]> {
	const fileContent = await fs.readFile(filePath, "utf8")
	let parsedData: unknown
	try {
		parsedData = JSON.parse(fileContent)
	} catch (error) {
		await quarantineCorruptFile(filePath, `API conversation history of task ${taskId} is not valid JSON (${error})`)
		return []
	}
	if (!Array.isArray(parsedData)) {
		await quarantineCorruptFile(
			filePath,
			`API conversation history of task ${taskId} is not an array (got ${typeof parsedData})`,
		)
		return []
	}
	if (parsedData.length === 0) {
		console.error(
			`[Roo-Debug] readApiMessages: Found API conversation history file, but it's empty (parsed as []). TaskId: ${taskId}, Path: ${filePath}`,
		)
	}
	return parsedData
}

/**
 * Parse a Cline-era claude_messages.json. Returns `undefined` when the file is gone or unusable, in which case it is
 * left on disk untouched.
 */
async function readLegacyApiMessages(taskId: string, oldPath: string): Promise<ApiMessage[] | undefined> {
	let fileContent: string
	try {
		fileContent = await fs.readFile(oldPath, "utf8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined
		}
		throw error
	}

	let parsedData: unknown
	try {
		parsedData = JSON.parse(fileContent)
	} catch (error) {
		console.warn(
			`[readApiMessages] Error parsing OLD API conversation history file (claude_messages.json), returning empty. TaskId: ${taskId}, Path: ${oldPath}, Error: ${error}`,
		)
		return undefined
	}
	if (!Array.isArray(parsedData)) {
		console.warn(
			`[readApiMessages] Parsed OLD data is not an array (got ${typeof parsedData}), returning empty. TaskId: ${taskId}, Path: ${oldPath}`,
		)
		return undefined
	}
	if (parsedData.length === 0) {
		console.error(
			`[Roo-Debug] readApiMessages: Found OLD API conversation history file (claude_messages.json), but it's empty (parsed as []). TaskId: ${taskId}, Path: ${oldPath}`,
		)
	}
	return parsedData
}

/**
 * Move a Cline-era claude_messages.json to api_conversation_history.json and return its messages.
 *
 * The read is often the only thing that happens to the task (search_task_history, the delegation re-attach check,
 * a resume), so the migration must be complete on its own: the new file is written atomically, in the format
 * saveApiMessages uses, before the old one is deleted. It runs under the same lock saveApiMessages takes on the new
 * file, so concurrent readers migrate once and a reader waiting on the lock finds the new file. If anything fails,
 * the old file stays where it is and the messages are still returned; the next read tries again.
 */
async function migrateLegacyApiMessages(taskId: string, filePath: string, oldPath: string): Promise<ApiMessage[]> {
	let legacyMessages: ApiMessage[] | undefined
	let migrated: "done" | "already-migrated" | "unusable"

	try {
		migrated = await withLockedJsonTransaction(filePath, filePath, async (writeJson) => {
			if (await fileExistsAtPath(filePath)) {
				return "already-migrated"
			}
			legacyMessages = await readLegacyApiMessages(taskId, oldPath)
			if (legacyMessages === undefined) {
				return "unusable"
			}
			await writeJson(legacyMessages)
			await fs.unlink(oldPath)
			return "done"
		})
	} catch (error) {
		console.warn(
			`[readApiMessages] Could not migrate claude_messages.json to ${GlobalFileNames.apiConversationHistory}, keeping the old file. TaskId: ${taskId}, Error: ${error}`,
		)
		// Without the lock the old file was not read yet; reading it is harmless because nothing is deleted here.
		return legacyMessages ?? (await readLegacyApiMessages(taskId, oldPath)) ?? []
	}

	if (migrated === "already-migrated") {
		return readCurrentApiMessages(taskId, filePath)
	}
	return legacyMessages ?? []
}

export async function saveApiMessages({
	messages,
	taskId,
	globalStoragePath,
}: {
	messages: ApiMessage[]
	taskId: string
	globalStoragePath: string
}) {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.apiConversationHistory)
	perfCounters.recordSave("apiHistory", messages)
	await safeWriteJson(filePath, messages)
}
