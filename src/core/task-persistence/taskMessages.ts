import { safeWriteJson } from "@roo-code/core/fs"
import { perfCounters } from "../../utils/perfCounters"
import * as path from "path"
import * as fs from "fs/promises"

import type { ClineMessage } from "@roo-code/types"

import { fileExistsAtPath } from "../../utils/fs"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { getTaskDirectoryPath } from "../../utils/storage"

import { quarantineCorruptFile } from "./quarantineCorruptFile"
import { logger } from "../../utils/logging"

export type ReadTaskMessagesOptions = {
	taskId: string
	globalStoragePath: string
}

export async function readTaskMessages({
	taskId,
	globalStoragePath,
}: ReadTaskMessagesOptions): Promise<ClineMessage[]> {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
	const fileExists = await fileExistsAtPath(filePath)

	if (!fileExists) {
		return []
	}

	let fileContent: string
	try {
		fileContent = await fs.readFile(filePath, "utf8")
	} catch (error) {
		// Not a corrupt file (for example a permission error): leave it where it is.
		logger.warn(
			`[readTaskMessages] Failed to read ${filePath} for task ${taskId}, returning empty: ${error instanceof Error ? error.message : String(error)}`,
		)
		return []
	}

	let parsedData: unknown
	try {
		parsedData = JSON.parse(fileContent)
	} catch (error) {
		await quarantineCorruptFile(
			filePath,
			`UI messages of task ${taskId} are not valid JSON (${error instanceof Error ? error.message : String(error)})`,
		)
		return []
	}
	if (!Array.isArray(parsedData)) {
		await quarantineCorruptFile(
			filePath,
			`UI messages of task ${taskId} are not an array (got ${typeof parsedData})`,
		)
		return []
	}
	return parsedData
}

export type SaveTaskMessagesOptions = {
	messages: ClineMessage[]
	taskId: string
	globalStoragePath: string
}

export async function saveTaskMessages({ messages, taskId, globalStoragePath }: SaveTaskMessagesOptions) {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
	perfCounters.recordSave("uiMessages", messages)
	await safeWriteJson(filePath, messages)
}
