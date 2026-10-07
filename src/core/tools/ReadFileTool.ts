/**
 * ReadFileTool - Codex-inspired file reading with indentation mode support.
 *
 * Supports two modes:
 * 1. Slice mode (default): Read contiguous lines with offset/limit
 * 2. Indentation mode: Extract semantic code blocks based on indentation hierarchy
 *
 * Also supports legacy format for backward compatibility:
 * - Legacy format: { files: [{ path: string, lineRanges?: [...] }] }
 */
import path from "path"
import * as fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"

import type { ReadFileParams, ReadFileMode, ReadFileToolParams, FileEntry, LineRange } from "@tumble-code/types"
import { isLegacyReadFileParams, type ClineSayTool } from "@tumble-code/types"

import { Task } from "../task/Task"
import { ignorePartialAskRejection } from "../task/AskIgnoredError"
import { formatResponse } from "../prompts/responses"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { getReadablePath } from "../../utils/path"
import { extractTextFromFile, addLineNumbers, getSupportedBinaryFormats } from "../../integrations/misc/extract-text"
import { readWithIndentation, readWithSlice } from "../../integrations/misc/indentation-reader"
import { DEFAULT_LINE_LIMIT } from "../prompts/tools/native-tools/read_file"
import type { ToolUse, PushToolResult } from "../../shared/tools"

import {
	DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
	DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
	isSupportedImageFormat,
	validateImageForProcessing,
	processImageFile,
	ImageMemoryTracker,
	type ImageCapableMode,
} from "./helpers/imageHelpers"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { describeReadFile } from "./toolDescriptors"

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Internal entry structure for tracking file read parameters.
 */
interface InternalFileEntry {
	path: string
	mode?: ReadFileMode
	offset?: number
	limit?: number
	anchor_line?: number
	max_levels?: number
	include_siblings?: boolean
	include_header?: boolean
	max_lines?: number
	/** Legacy `lineRanges`, converted to 1-based offset/limit pairs and read one after another in slice mode. */
	slices?: Array<{ offset: number; limit: number }>
}

interface FileResult {
	path: string
	status: "approved" | "denied" | "blocked" | "error" | "pending"
	content?: string
	error?: string
	notice?: string
	nativeContent?: string
	imageDataUrl?: string
	feedbackText?: string
	feedbackImages?: string[]
	// Store the original entry for mode processing
	entry?: InternalFileEntry
}

// ─── Tool Implementation ──────────────────────────────────────────────────────

export class ReadFileTool extends BaseTool<"read_file"> {
	readonly name = "read_file" as const

	async execute(params: ReadFileToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		// Dispatch to legacy or new execution path based on format
		if (isLegacyReadFileParams(params)) {
			return this.executeLegacy(params.files, task, callbacks)
		}

		return this.executeNew(params, task, callbacks)
	}

	/**
	 * Execute new single-file format with slice/indentation mode support.
	 */
	private async executeNew(params: ReadFileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, toolCallId } = callbacks
		const filePath = params.path

		// Validate input
		if (!filePath) {
			this.recordFailure(task, "read_file")
			const errorMsg = await task.sayAndCreateMissingParamError("read_file", "path")
			pushToolResult(`Error: ${errorMsg}`)
			return
		}

		// Validate line number parameters (must be 1-indexed positive integers)
		if (params.offset !== undefined && params.offset < 1) {
			const errorMsg = `offset must be a 1-indexed line number (got ${params.offset}). Line numbers start at 1.`
			pushToolResult(`Error: ${errorMsg}`)
			return
		}
		if (params.indentation?.anchor_line !== undefined && params.indentation.anchor_line < 1) {
			const errorMsg = `anchor_line must be a 1-indexed line number (got ${params.indentation.anchor_line}). Line numbers start at 1.`
			pushToolResult(`Error: ${errorMsg}`)
			return
		}

		const fileEntry: InternalFileEntry = {
			path: filePath,
			mode: params.mode,
			offset: params.offset,
			limit: params.limit,
			anchor_line: params.indentation?.anchor_line,
			max_levels: params.indentation?.max_levels,
			include_siblings: params.indentation?.include_siblings,
			include_header: params.indentation?.include_header,
			max_lines: params.indentation?.max_lines,
		}

		await this.readEntries(task, [fileEntry], pushToolResult, toolCallId)
	}

	/**
	 * Read each entry in turn (rooignore check, approval, read) and push one combined result.
	 * Both input formats end here, so images, size limits and the cumulative image memory
	 * limit behave the same for both.
	 */
	private async readEntries(
		task: Task,
		entries: InternalFileEntry[],
		pushToolResult: PushToolResult,
		toolCallId?: string,
	): Promise<void> {
		const supportsImages = task.api.getModel().info.supportsImages ?? false
		const fileResults: FileResult[] = []
		const imageMemoryTracker = new ImageMemoryTracker()
		let imageLimits: { maxImageFileSize: number; maxTotalImageSize: number } | undefined

		try {
			for (const entry of entries) {
				const fileResult: FileResult = { path: entry.path, status: "pending", entry }
				fileResults.push(fileResult)
				// Update this entry in place, so two entries for the same path never overwrite each other.
				const updateFileResult = (_path: string, updates: Partial<FileResult>) => {
					Object.assign(fileResult, updates)
				}
				const relPath = entry.path

				// RooIgnore validation
				const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
				if (!accessAllowed) {
					await task.say("rooignore_error", relPath)
					const errorMsg = formatResponse.rooIgnoreError(relPath)
					updateFileResult(relPath, {
						status: "blocked",
						error: errorMsg,
						nativeContent: `File: ${relPath}\nError: ${errorMsg}`,
					})
					continue
				}

				// Request user approval
				await this.requestApproval(task, [fileResult], updateFileResult, toolCallId)
				if (fileResult.status !== "approved") continue

				if (!imageLimits) {
					const state = await task.providerRef.deref()?.getState()
					const {
						maxImageFileSize = DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
						maxTotalImageSize = DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
					} = state ?? {}
					imageLimits = { maxImageFileSize, maxTotalImageSize }
				}

				await this.readApprovedFile(
					task,
					fileResult,
					supportsImages,
					imageLimits,
					imageMemoryTracker,
					updateFileResult,
				)
			}

			const hasErrors = fileResults.some((r) => r.status === "error" || r.status === "blocked")
			if (hasErrors) {
				task.didToolFailInCurrentTurn = true
			}

			this.buildAndPushResult(task, fileResults, pushToolResult)
		} catch (error) {
			const current = fileResults.at(-1)
			const relPath = current?.path || "unknown"
			const errorMsg = error instanceof Error ? error.message : String(error)

			if (current) {
				Object.assign(current, {
					status: "error",
					error: `Error reading file: ${errorMsg}`,
					nativeContent: `File: ${relPath}\nError: ${errorMsg}`,
				})
			}

			await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)
			task.didToolFailInCurrentTurn = true

			const errorResult = fileResults
				.filter((r) => r.nativeContent)
				.map((r) => r.nativeContent)
				.join("\n\n---\n\n")

			pushToolResult(errorResult || `Error: ${errorMsg}`)
		}
	}

	/**
	 * Read one approved file into its result: directory check, binary formats, then text.
	 */
	private async readApprovedFile(
		task: Task,
		fileResult: FileResult,
		supportsImages: boolean,
		imageLimits: { maxImageFileSize: number; maxTotalImageSize: number },
		imageMemoryTracker: ImageMemoryTracker,
		updateFileResult: (path: string, updates: Partial<FileResult>) => void,
	): Promise<void> {
		const relPath = fileResult.path
		const fullPath = path.resolve(task.cwd, relPath)
		const entry = fileResult.entry!

		try {
			// Check if path is a directory
			const stats = await fs.stat(fullPath)
			if (stats.isDirectory()) {
				const errorMsg = `Cannot read '${relPath}' because it is a directory. Use list_files tool instead.`
				updateFileResult(relPath, {
					status: "error",
					error: errorMsg,
					nativeContent: `File: ${relPath}\nError: ${errorMsg}`,
				})
				await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)
				return
			}

			// Check for binary file
			const isBinary = await isBinaryFile(fullPath)

			if (isBinary) {
				await this.handleBinaryFile(
					task,
					relPath,
					fullPath,
					supportsImages,
					imageLimits.maxImageFileSize,
					imageLimits.maxTotalImageSize,
					imageMemoryTracker,
					updateFileResult,
				)
				return
			}

			// Read text file content with lossy UTF-8 conversion
			// Reading as Buffer first allows graceful handling of non-UTF8 bytes
			// (they become U+FFFD replacement characters instead of throwing)
			const buffer = await fs.readFile(fullPath)
			const fileContent = buffer.toString("utf-8")
			const result = this.processTextFile(fileContent, entry)

			await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

			updateFileResult(relPath, {
				nativeContent: `File: ${relPath}\n${result}`,
			})
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			updateFileResult(relPath, {
				status: "error",
				error: `Error reading file: ${errorMsg}`,
				nativeContent: `File: ${relPath}\nError: ${errorMsg}`,
			})
			await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)
		}
	}

	/**
	 * Process a text file according to the requested mode.
	 */
	private processTextFile(content: string, entry: InternalFileEntry): string {
		const mode = entry.mode || "slice"

		if (mode === "indentation") {
			// Indentation mode: semantic block extraction
			// When anchor_line is not provided, default to offset (which defaults to 1)
			const anchorLine = entry.anchor_line ?? entry.offset ?? 1
			const result = readWithIndentation(content, {
				anchorLine,
				maxLevels: entry.max_levels,
				includeSiblings: entry.include_siblings,
				includeHeader: entry.include_header,
				limit: entry.limit ?? DEFAULT_LINE_LIMIT,
				maxLines: entry.max_lines,
			})

			let output = result.content

			if (result.wasTruncated && result.includedRanges.length > 0) {
				const [start, end] = result.includedRanges[0]
				const nextOffset = end + 1
				const effectiveLimit = entry.limit ?? DEFAULT_LINE_LIMIT
				// Put truncation warning at TOP (before content) to match @ mention format
				output = `IMPORTANT: File content truncated.
	Status: Showing lines ${start}-${end} of ${result.totalLines} total lines.
	To read more: Use the read_file tool with offset=${nextOffset} and limit=${effectiveLimit}.
	
	${result.content}`
			} else if (result.includedRanges.length > 0) {
				const rangeStr = result.includedRanges.map(([s, e]) => `${s}-${e}`).join(", ")
				output += `\n\nIncluded ranges: ${rangeStr} (total: ${result.totalLines} lines)`
			}

			return output
		}

		if (entry.slices && entry.slices.length > 0) {
			return entry.slices.map((slice) => this.readSlice(content, slice.offset, slice.limit)).join("\n\n")
		}

		return this.readSlice(content, entry.offset ?? 1, entry.limit ?? DEFAULT_LINE_LIMIT)
	}

	/**
	 * Slice mode (default): simple offset/limit reading.
	 */
	private readSlice(content: string, offset1: number, limit: number): string {
		// NOTE: read_file offset is 1-based externally; convert to 0-based for readWithSlice.
		const offset0 = Math.max(0, offset1 - 1)

		const result = readWithSlice(content, offset0, limit)

		let output = result.content

		if (result.wasTruncated) {
			const startLine = offset1
			const endLine = offset1 + result.returnedLines - 1
			const nextOffset = endLine + 1
			// Put truncation warning at TOP (before content) to match @ mention format
			output = `IMPORTANT: File content truncated.
	Status: Showing lines ${startLine}-${endLine} of ${result.totalLines} total lines.
	To read more: Use the read_file tool with offset=${nextOffset} and limit=${limit}.
	
	${result.content}`
		} else if (result.returnedLines === 0) {
			// No lines come back for an empty file and for an offset past the last line; the model
			// needs to know which, or it takes a long file for an empty one.
			output =
				content.length === 0 || result.totalLines === 0
					? "Note: File is empty"
					: `Note: offset ${offset1} is past the end of the file, which has ${result.totalLines} lines. Use an offset from 1 to ${result.totalLines}.`
		}

		return output
	}

	/**
	 * The modes other than the task's own that run on an image-capable model,
	 * named in the notice for an image this model cannot see. Any failure
	 * counts as "none", which tells the model not to delegate the image.
	 */
	private async findOtherImageCapableModes(task: Task): Promise<ImageCapableMode[]> {
		try {
			const modes = (await task.providerRef.deref()?.findImageCapableModes()) ?? []
			return modes.filter(({ slug }) => slug !== task.taskMode)
		} catch {
			return []
		}
	}

	/**
	 * Handle binary file processing (images, PDF, DOCX, etc.).
	 */
	private async handleBinaryFile(
		task: Task,
		relPath: string,
		fullPath: string,
		supportsImages: boolean,
		maxImageFileSize: number,
		maxTotalImageSize: number,
		imageMemoryTracker: ImageMemoryTracker,
		updateFileResult: (path: string, updates: Partial<FileResult>) => void,
	): Promise<void> {
		const fileExtension = path.extname(relPath).toLowerCase()
		const supportedBinaryFormats = getSupportedBinaryFormats()

		// Handle image files
		if (isSupportedImageFormat(fileExtension)) {
			try {
				const validationResult = await validateImageForProcessing(
					fullPath,
					supportsImages,
					maxImageFileSize,
					maxTotalImageSize,
					imageMemoryTracker.getTotalMemoryUsed(),
					supportsImages ? [] : await this.findOtherImageCapableModes(task),
				)

				if (!validationResult.isValid) {
					await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)
					updateFileResult(relPath, {
						nativeContent: `File: ${relPath}\nNote: ${validationResult.notice}`,
					})
					return
				}

				const imageResult = await processImageFile(fullPath)
				imageMemoryTracker.addMemoryUsage(imageResult.sizeInMB)
				await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

				updateFileResult(relPath, {
					nativeContent: `File: ${relPath}\nNote: ${imageResult.notice}`,
					imageDataUrl: imageResult.dataUrl,
				})
				return
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				updateFileResult(relPath, {
					status: "error",
					error: `Error reading image file: ${errorMsg}`,
					nativeContent: `File: ${relPath}\nError: ${errorMsg}`,
				})
				await task.say("error", `Error reading image file ${relPath}: ${errorMsg}`)
				return
			}
		}

		// Handle other supported binary formats (PDF, DOCX, etc.)
		if (supportedBinaryFormats && supportedBinaryFormats.includes(fileExtension)) {
			try {
				const content = await extractTextFromFile(fullPath)
				const numberedContent = addLineNumbers(content)
				const lineCount = content.split("\n").length

				await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

				updateFileResult(relPath, {
					nativeContent:
						lineCount > 0
							? `File: ${relPath}\nLines 1-${lineCount}:\n${numberedContent}`
							: `File: ${relPath}\nNote: File is empty`,
				})
				return
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				updateFileResult(relPath, {
					status: "error",
					error: `Error extracting text: ${errorMsg}`,
					nativeContent: `File: ${relPath}\nError: ${errorMsg}`,
				})
				await task.say("error", `Error extracting text from ${relPath}: ${errorMsg}`)
				return
			}
		}

		// Unsupported binary format
		const fileFormat = fileExtension.slice(1) || "bin"
		updateFileResult(relPath, {
			notice: `Binary file format: ${fileFormat}`,
			nativeContent: `File: ${relPath}\nBinary file (${fileFormat}) - content not displayed`,
		})
	}

	/**
	 * Request user approval for file reads.
	 */
	private async requestApproval(
		task: Task,
		filesToApprove: FileResult[],
		updateFileResult: (path: string, updates: Partial<FileResult>) => void,
		toolCallId?: string,
	): Promise<void> {
		if (filesToApprove.length === 0) return

		if (filesToApprove.length > 1) {
			// Batch approval
			const batchFiles = filesToApprove.map((fileResult) => {
				const relPath = fileResult.path
				const fullPath = path.resolve(task.cwd, relPath)
				const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)
				const readablePath = getReadablePath(task.cwd, relPath)

				const lineSnippet = this.getLineSnippet(fileResult.entry!)
				const key = `${readablePath}${lineSnippet ? ` (${lineSnippet})` : ""}`

				return { path: readablePath, lineSnippet, isOutsideWorkspace, key, content: fullPath }
			})

			const completeMessage = JSON.stringify({ tool: "readFile", batchFiles, toolCallId } satisfies ClineSayTool)
			const { response, text, images } = await task.ask("tool", completeMessage, false)

			if (response === "yesButtonClicked") {
				if (text) await task.say("user_feedback", text, images)
				filesToApprove.forEach((fr) => {
					updateFileResult(fr.path, { status: "approved", feedbackText: text, feedbackImages: images })
				})
			} else if (response === "noButtonClicked") {
				if (text) await task.say("user_feedback", text, images)
				task.didRejectTool = true
				filesToApprove.forEach((fr) => {
					updateFileResult(fr.path, {
						status: "denied",
						nativeContent: `File: ${fr.path}\nStatus: Denied by user`,
						feedbackText: text,
						feedbackImages: images,
					})
				})
			} else {
				// Individual permissions
				try {
					const individualPermissions = JSON.parse(text || "{}")
					let hasAnyDenial = false

					batchFiles.forEach((batchFile, index) => {
						const fileResult = filesToApprove[index]
						const approved = individualPermissions[batchFile.key] === true

						if (approved) {
							updateFileResult(fileResult.path, { status: "approved" })
						} else {
							hasAnyDenial = true
							updateFileResult(fileResult.path, {
								status: "denied",
								nativeContent: `File: ${fileResult.path}\nStatus: Denied by user`,
							})
						}
					})

					if (hasAnyDenial) task.didRejectTool = true
				} catch {
					task.didRejectTool = true
					filesToApprove.forEach((fr) => {
						updateFileResult(fr.path, {
							status: "denied",
							nativeContent: `File: ${fr.path}\nStatus: Denied by user`,
						})
					})
				}
			}
		} else {
			// Single file approval
			const fileResult = filesToApprove[0]
			const relPath = fileResult.path
			const fullPath = path.resolve(task.cwd, relPath)
			const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)
			const lineSnippet = this.getLineSnippet(fileResult.entry!)

			const startLine = this.getStartLine(fileResult.entry!)

			const completeMessage = JSON.stringify({
				tool: "readFile",
				path: getReadablePath(task.cwd, relPath),
				isOutsideWorkspace,
				content: fullPath,
				reason: lineSnippet,
				startLine,
				toolCallId,
			} satisfies ClineSayTool)

			const { response, text, images } = await task.ask("tool", completeMessage, false)

			if (response !== "yesButtonClicked") {
				if (text) await task.say("user_feedback", text, images)
				task.didRejectTool = true
				updateFileResult(relPath, {
					status: "denied",
					nativeContent: `File: ${relPath}\nStatus: Denied by user`,
					feedbackText: text,
					feedbackImages: images,
				})
			} else {
				if (text) await task.say("user_feedback", text, images)
				updateFileResult(relPath, { status: "approved", feedbackText: text, feedbackImages: images })
			}
		}
	}

	/**
	 * Get the starting line number for navigation purposes.
	 */
	private getStartLine(entry: InternalFileEntry): number | undefined {
		if (entry.slices && entry.slices.length > 0) {
			const offset = entry.slices[0].offset
			return offset > 1 ? offset : undefined
		}
		if (entry.mode === "indentation") {
			// For indentation mode, always return the effective anchor line
			return entry.anchor_line ?? entry.offset ?? 1
		}
		const offset = entry.offset ?? 1
		return offset > 1 ? offset : undefined
	}

	/**
	 * Generate a human-readable line snippet for approval messages.
	 */
	private getLineSnippet(entry: InternalFileEntry): string {
		if (entry.slices && entry.slices.length > 0) {
			return entry.slices.map((slice) => `(lines ${slice.offset}-${slice.offset + slice.limit - 1})`).join(", ")
		}

		if (entry.mode === "indentation") {
			// Always show indentation mode with the effective anchor line
			const effectiveAnchor = entry.anchor_line ?? entry.offset ?? 1
			return `(indentation mode at line ${effectiveAnchor})`
		}

		const limit = entry.limit ?? DEFAULT_LINE_LIMIT
		const offset1 = entry.offset ?? 1

		if (offset1 > 1) {
			return `(lines ${offset1}-${offset1 + limit - 1})`
		}

		// Always show the line limit, even when using the default
		return `(up to ${limit} lines)`
	}

	/**
	 * Build and push the final result to the tool output.
	 */
	private buildAndPushResult(task: Task, fileResults: FileResult[], pushToolResult: PushToolResult): void {
		const finalResult = fileResults
			.filter((r) => r.nativeContent)
			.map((r) => r.nativeContent)
			.join("\n\n---\n\n")

		const fileImageUrls = fileResults.filter((r) => r.imageDataUrl).map((r) => r.imageDataUrl as string)

		let statusMessage = ""
		let feedbackImages: string[] = []

		const deniedWithFeedback = fileResults.find((r) => r.status === "denied" && r.feedbackText)

		if (deniedWithFeedback?.feedbackText) {
			statusMessage = formatResponse.toolDeniedWithFeedback(deniedWithFeedback.feedbackText)
			feedbackImages = deniedWithFeedback.feedbackImages || []
		} else if (task.didRejectTool) {
			statusMessage = formatResponse.toolDenied()
		} else {
			const approvedWithFeedback = fileResults.find((r) => r.status === "approved" && r.feedbackText)
			if (approvedWithFeedback?.feedbackText) {
				statusMessage = formatResponse.toolApprovedWithFeedback(approvedWithFeedback.feedbackText)
				feedbackImages = approvedWithFeedback.feedbackImages || []
			}
		}

		const allImages = [...feedbackImages, ...fileImageUrls]
		const finalModelSupportsImages = task.api.getModel().info.supportsImages ?? false
		const imagesToInclude = finalModelSupportsImages ? allImages : []

		if (statusMessage || imagesToInclude.length > 0) {
			const result = formatResponse.toolResult(
				statusMessage || finalResult,
				imagesToInclude.length > 0 ? imagesToInclude : undefined,
			)

			if (typeof result === "string") {
				pushToolResult(statusMessage ? `${result}\n${finalResult}` : result)
			} else {
				if (statusMessage) {
					const textBlock = { type: "text" as const, text: finalResult }
					pushToolResult([...result, textBlock])
				} else {
					pushToolResult(result)
				}
			}
		} else {
			pushToolResult(finalResult)
		}
	}

	getReadFileToolDescription(blockName: string, blockParams: { path?: string }): string
	getReadFileToolDescription(blockName: string, nativeArgs: ReadFileParams): string
	getReadFileToolDescription(blockName: string, second: unknown): string {
		// One implementation with the read_file row of the tool descriptor table.
		return describeReadFile(blockName, second)
	}

	override async handlePartial(task: Task, block: ToolUse<"read_file">): Promise<void> {
		// Handle both legacy and new format for partial display
		let filePath = ""
		if (block.nativeArgs) {
			if (isLegacyReadFileParams(block.nativeArgs)) {
				// Legacy format - show first file
				filePath = block.nativeArgs.files[0]?.path ?? ""
			} else {
				filePath = block.nativeArgs.path ?? ""
			}
		}

		const fullPath = filePath ? path.resolve(task.cwd, filePath) : ""
		const sharedMessageProps: ClineSayTool = {
			tool: "readFile",
			path: getReadablePath(task.cwd, filePath),
			isOutsideWorkspace: filePath ? isPathOutsideWorkspace(fullPath) : false,
			// Stamp the native tool-call id so the finalized-duplicate dedup can
			// recognise this placeholder and the later complete card as one
			// invocation even though their payloads differ in text.
			toolCallId: block.id,
		}
		const partialMessage = JSON.stringify({
			...sharedMessageProps,
			content: undefined,
		} satisfies ClineSayTool)
		await task.ask("tool", partialMessage, block.partial).catch(ignorePartialAskRejection)
	}

	/**
	 * Execute legacy multi-file format for backward compatibility.
	 * This handles the old format: { files: [{ path: string, lineRanges?: [...] }] }
	 * Each entry becomes a single-file entry and goes through the same reading code as the
	 * new format, one approval per file.
	 */
	private async executeLegacy(fileEntries: FileEntry[], task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks

		if (!fileEntries || fileEntries.length === 0) {
			this.recordFailure(task, "read_file")
			const errorMsg = await task.sayAndCreateMissingParamError("read_file", "files")
			pushToolResult(`Error: ${errorMsg}`)
			return
		}

		// The legacy approval cards never carried the tool-call id: several cards of one call
		// must not be taken for duplicates of each other.
		await this.readEntries(task, fileEntries.map(legacyEntryToInternal), pushToolResult)
	}
}

/**
 * Convert one legacy `files` entry to the single-file entry. Line ranges are 1-based and
 * inclusive; each becomes an offset/limit slice.
 */
function legacyEntryToInternal(entry: FileEntry): InternalFileEntry {
	const slices = (entry.lineRanges ?? []).map((range: LineRange) => {
		const start = Number.isFinite(range.start) ? Math.floor(range.start) : 1
		const end = Number.isFinite(range.end) ? Math.floor(range.end) : start
		const offset = Math.max(1, start)
		// Cap each range at the default line limit, like a new-format read without a limit;
		// the truncation notice then tells the model how to read on.
		const limit = Math.min(DEFAULT_LINE_LIMIT, Math.max(1, end - offset + 1))
		return { offset, limit }
	})
	return slices.length > 0 ? { path: entry.path, slices } : { path: entry.path }
}

export const readFileTool = new ReadFileTool()
