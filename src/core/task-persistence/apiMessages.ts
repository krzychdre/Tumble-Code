import { safeWriteJson } from "@roo-code/core/fs"
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
	summary?: unknown[]
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

	// The Cline-era claude_messages.json is no longer read (deleted 2026-09-28,
	// ai_plans/2026-09-28_delete-old-config-migrations.md).
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
