// Files, images, mentions, external links and checkpoints.

import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import { checkoutDiffPayloadSchema, checkoutRestorePayloadSchema } from "@roo-code/types"
import pWaitFor from "p-wait-for"
import { t } from "../../../i18n"
import { openImage, saveImage } from "../../../integrations/misc/image-handler"
import { openFile } from "../../../integrations/misc/open-file"
import { selectImages } from "../../../integrations/misc/process-images"
import { resolveDefaultSaveUri, saveLastExportPath } from "../../../utils/export"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { openMention } from "../../mentions"
import type { MessageHandlerMap } from "./types"

export const filesAndCheckpointsHandlers: MessageHandlerMap = {
	selectImages: async (ctx, message) => {
		const { provider } = ctx
		const images = await selectImages()
		await provider.postMessageToWebview({
			type: "selectedImages",
			images,
			context: message.context,
			messageTs: message.messageTs,
		})
	},

	openImage: (_ctx, message) => {
		openImage(message.text!, { values: message.values })
	},

	saveImage: async (ctx, message) => {
		const { provider } = ctx
		if (message.dataUri) {
			const matches = message.dataUri.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/)
			if (!matches) {
				// Let saveImage handle invalid URI error
				saveImage(message.dataUri, vscode.Uri.file(""))
				return
			}
			const format = matches[1]
			const defaultFileName = `img_${Date.now()}.${format}`

			const defaultUri = await resolveDefaultSaveUri(
				provider.contextProxy,
				"lastImageSavePath",
				defaultFileName,
				{
					useWorkspace: false,
					fallbackDir: path.join(os.homedir(), "Downloads"),
				},
			)

			const savedUri = await saveImage(message.dataUri, defaultUri)

			if (savedUri) {
				await saveLastExportPath(provider.contextProxy, "lastImageSavePath", savedUri)
			}
		}
	},

	openFile: (ctx, message) => {
		const { getCurrentCwd } = ctx
		let filePath: string = message.text!
		if (!path.isAbsolute(filePath)) {
			filePath = path.join(getCurrentCwd(), filePath)
		}
		openFile(filePath, message.values as { create?: boolean; content?: string; line?: number })
	},

	readFileContent: async (ctx, message) => {
		const { provider, getCurrentCwd } = ctx
		const relPath = message.text || ""
		if (!relPath) {
			provider.postMessageToWebview({
				type: "fileContent",
				fileContent: { path: relPath, content: null, error: "No path provided" },
			})
			return
		}
		try {
			const cwd = getCurrentCwd()
			if (!cwd) {
				provider.postMessageToWebview({
					type: "fileContent",
					fileContent: { path: relPath, content: null, error: "No workspace path available" },
				})
				return
			}
			const absPath = path.resolve(cwd, relPath)
			// Workspace-boundary validation: prevent path traversal attacks
			if (isPathOutsideWorkspace(absPath)) {
				provider.postMessageToWebview({
					type: "fileContent",
					fileContent: { path: relPath, content: null, error: "Path is outside workspace" },
				})
				return
			}
			const content = await fs.readFile(absPath, "utf-8")
			provider.postMessageToWebview({ type: "fileContent", fileContent: { path: relPath, content } })
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err)
			provider.postMessageToWebview({
				type: "fileContent",
				fileContent: { path: relPath, content: null, error: errorMsg },
			})
		}
	},

	openMention: (ctx, message) => {
		const { getCurrentCwd } = ctx
		openMention(getCurrentCwd(), message.text)
	},

	openExternal: (_ctx, message) => {
		if (message.url) {
			vscode.env.openExternal(vscode.Uri.parse(message.url))
		}
	},

	checkpointDiff: async (ctx, message) => {
		const { provider } = ctx
		const result = checkoutDiffPayloadSchema.safeParse(message.payload)

		if (result.success) {
			await provider.getCurrentTask()?.checkpointDiff(result.data)
		}
	},

	checkpointRestore: async (ctx, message) => {
		const { provider } = ctx
		const result = checkoutRestorePayloadSchema.safeParse(message.payload)

		if (result.success) {
			await provider.cancelTask()

			try {
				await pWaitFor(() => provider.getCurrentTask()?.isInitialized === true, { timeout: 3_000 })
			} catch (error) {
				vscode.window.showErrorMessage(t("common:errors.checkpoint_timeout"))
			}

			try {
				await provider.getCurrentTask()?.checkpointRestore(result.data)
			} catch (error) {
				vscode.window.showErrorMessage(t("common:errors.checkpoint_failed"))
			}
		}
	},
}
