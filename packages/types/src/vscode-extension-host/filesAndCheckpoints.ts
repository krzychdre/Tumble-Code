/*
 * Extension host channel, filesAndCheckpoints domain: the webview requests handled by
 * src/core/webview/messageHandlers/filesAndCheckpoints.ts and the host to view
 * messages of the same domain.
 */

import { z } from "zod"

/** Images, files, links and checkpoints. */
export type FilesAndCheckpointsWebviewMessageType =
	| "selectImages"
	| "openImage"
	| "saveImage"
	| "openFile"
	| "readFileContent"
	| "openMention"
	| "openExternal"
	| "checkpointDiff"
	| "checkpointRestore"

/** Selected images, file content and checkpoint updates. */
export type FilesAndCheckpointsExtensionMessageType =
	| "selectedImages"
	| "fileContent"
	| "currentCheckpointUpdated"
	| "checkpointInitWarning"

export const checkoutDiffPayloadSchema = z.object({
	ts: z.number().optional(),
	previousCommitHash: z.string().optional(),
	commitHash: z.string(),
	mode: z.enum(["full", "checkpoint", "from-init", "to-current"]),
})

export type CheckpointDiffPayload = z.infer<typeof checkoutDiffPayloadSchema>

export const checkoutRestorePayloadSchema = z.object({
	ts: z.number(),
	commitHash: z.string(),
	mode: z.enum(["preview", "restore"]),
})

export type CheckpointRestorePayload = z.infer<typeof checkoutRestorePayloadSchema>
