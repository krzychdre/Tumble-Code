// Debug views: raw task history files, error diagnostics, markdown preview and plan review.

import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import { openFile } from "../../../integrations/misc/open-file"
import { fileExistsAtPath } from "../../../utils/fs"
import { generateErrorDiagnostics } from "../diagnosticsHandler"
import type { MessageHandler, MessageHandlerMap } from "./types"

const openDebugHistory: MessageHandler = async (ctx, message) => {
	const { provider } = ctx
	const currentTask = provider.getCurrentTask()
	if (!currentTask) {
		vscode.window.showErrorMessage("No active task to view history for")
		return
	}

	try {
		const { getTaskDirectoryPath } = await import("../../../utils/storage")
		const globalStoragePath = provider.contextProxy.globalStorageUri.fsPath
		const taskDirPath = await getTaskDirectoryPath(globalStoragePath, currentTask.taskId)

		const fileName = message.type === "openDebugApiHistory" ? "api_conversation_history.json" : "ui_messages.json"
		const sourceFilePath = path.join(taskDirPath, fileName)

		// Check if file exists
		if (!(await fileExistsAtPath(sourceFilePath))) {
			vscode.window.showErrorMessage(`File not found: ${fileName}`)
			return
		}

		// Read the source file
		const content = await fs.readFile(sourceFilePath, "utf8")
		let jsonContent: unknown

		try {
			jsonContent = JSON.parse(content)
		} catch {
			vscode.window.showErrorMessage(`Failed to parse ${fileName}`)
			return
		}

		// Prettify the JSON
		const prettifiedContent = JSON.stringify(jsonContent, null, 2)

		// Create a temporary file
		const tmpDir = os.tmpdir()
		const timestamp = Date.now()
		const tempFileName = `roo-debug-${message.type === "openDebugApiHistory" ? "api" : "ui"}-${currentTask.taskId.slice(0, 8)}-${timestamp}.json`
		const tempFilePath = path.join(tmpDir, tempFileName)

		await fs.writeFile(tempFilePath, prettifiedContent, "utf8")

		// Open the temp file in VS Code
		const doc = await vscode.workspace.openTextDocument(tempFilePath)
		await vscode.window.showTextDocument(doc, { preview: true })
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		provider.log(`Error opening debug history: ${errorMessage}`)
		vscode.window.showErrorMessage(`Failed to open debug history: ${errorMessage}`)
	}
}

export const debugHandlers: MessageHandlerMap = {
	openMarkdownPreview: async (ctx, message) => {
		const { provider } = ctx
		if (message.text) {
			try {
				const tmpDir = os.tmpdir()
				const timestamp = Date.now()
				const tempFileName = `roo-preview-${timestamp}.md`
				const tempFilePath = path.join(tmpDir, tempFileName)

				await fs.writeFile(tempFilePath, message.text, "utf8")

				const doc = await vscode.workspace.openTextDocument(tempFilePath)
				await vscode.commands.executeCommand("markdown.showPreview", doc.uri)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Error opening markdown preview: ${errorMessage}`)
				vscode.window.showErrorMessage(`Failed to open markdown preview: ${errorMessage}`)
			}
		}
	},

	openPlanReview: async (ctx, message) => {
		const { provider, getCurrentCwd } = ctx
		const { PlanReviewPanel } = await import("../PlanReviewPanel")
		if (message.text) {
			// File mode: resolve path like openFile does.
			let filePath: string = message.text
			if (!path.isAbsolute(filePath)) {
				filePath = path.join(getCurrentCwd(), filePath)
			}
			await PlanReviewPanel.open(provider.context, { filePath })
		} else if (message.values?.markdown) {
			// Content mode: raw markdown passed from the webview.
			await PlanReviewPanel.open(provider.context, {
				markdown: message.values.markdown as string,
			})
		}
	},

	openDebugApiHistory: openDebugHistory,

	openDebugUiHistory: openDebugHistory,

	downloadErrorDiagnostics: async (ctx, message) => {
		const { provider } = ctx
		const currentTask = provider.getCurrentTask()
		if (!currentTask) {
			vscode.window.showErrorMessage("No active task to generate diagnostics for")
			return
		}

		await generateErrorDiagnostics({
			taskId: currentTask.taskId,
			globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
			values: message.values,
			log: (msg) => provider.log(msg),
		})
	},
}
