import * as vscode from "vscode"
import {
	QDRANT_CODE_BLOCK_NAMESPACE,
	MAX_FILE_SIZE_BYTES,
	BATCH_SEGMENT_THRESHOLD,
	MAX_BATCH_RETRIES,
	INITIAL_RETRY_DELAY_MS,
} from "../constants"
import { createHash } from "crypto"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { v5 as uuidv5 } from "uuid"
import { Ignore } from "ignore"
import { scannerExtensions } from "../shared/supported-extensions"
import {
	IFileWatcher,
	FileProcessingResult,
	IEmbedder,
	IVectorStore,
	PointStruct,
	BatchProcessingSummary,
} from "../interfaces"
import { codeParser } from "./parser"
import { CacheManager } from "../cache-manager"
import { generateNormalizedAbsolutePath, generateRelativeFilePath } from "../shared/get-relative-path"
import { isPathInIgnoredDirectory } from "../../glob/ignore-utils"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import { sanitizeErrorMessage } from "../shared/validation-helpers"
import { Package } from "../../../shared/package"
import { reportEmbeddingUsage } from "../embedding-usage"

/**
 * Implementation of the file watcher interface
 */
export class FileWatcher implements IFileWatcher {
	private ignoreInstance?: Ignore
	private fileWatcher?: vscode.FileSystemWatcher
	private fileWatcherListeners: vscode.Disposable[] = []
	private ignoreController: RooIgnoreController
	/** True when this instance created ignoreController itself, so it must dispose it. */
	private readonly ownsIgnoreController: boolean
	private accumulatedEvents: Map<string, { uri: vscode.Uri; type: "create" | "change" | "delete" }> = new Map()
	private batchProcessDebounceTimer?: NodeJS.Timeout
	private readonly BATCH_DEBOUNCE_DELAY_MS = 500
	private readonly FILE_PROCESSING_CONCURRENCY_LIMIT = 10
	private readonly batchSegmentThreshold: number

	private readonly _onDidStartBatchProcessing = new vscode.EventEmitter<string[]>()
	private readonly _onBatchProgressUpdate = new vscode.EventEmitter<{
		processedInBatch: number
		totalInBatch: number
		currentFile?: string
	}>()
	private readonly _onDidFinishBatchProcessing = new vscode.EventEmitter<BatchProcessingSummary>()

	/**
	 * Event emitted when a batch of files begins processing
	 */
	public readonly onDidStartBatchProcessing = this._onDidStartBatchProcessing.event

	/**
	 * Event emitted to report progress during batch processing
	 */
	public readonly onBatchProgressUpdate = this._onBatchProgressUpdate.event

	/**
	 * Event emitted when a batch of files has finished processing
	 */
	public readonly onDidFinishBatchProcessing = this._onDidFinishBatchProcessing.event

	/**
	 * Creates a new file watcher
	 * @param workspacePath Path to the workspace
	 * @param context VS Code extension context
	 * @param embedder Optional embedder
	 * @param vectorStore Optional vector store
	 * @param cacheManager Cache manager
	 */
	constructor(
		private workspacePath: string,
		private context: vscode.ExtensionContext,
		private readonly cacheManager: CacheManager,
		private embedder?: IEmbedder,
		private vectorStore?: IVectorStore,
		ignoreInstance?: Ignore,
		ignoreController?: RooIgnoreController,
		batchSegmentThreshold?: number,
	) {
		this.ownsIgnoreController = !ignoreController
		this.ignoreController = ignoreController || new RooIgnoreController(workspacePath)
		if (ignoreInstance) {
			this.ignoreInstance = ignoreInstance
		}
		// Get the configurable batch size from VSCode settings, fallback to default
		// If not provided in constructor, try to get from VSCode settings
		if (batchSegmentThreshold !== undefined) {
			this.batchSegmentThreshold = batchSegmentThreshold
		} else {
			try {
				this.batchSegmentThreshold = vscode.workspace
					.getConfiguration(Package.name)
					.get<number>("codeIndex.embeddingBatchSize", BATCH_SEGMENT_THRESHOLD)
			} catch {
				// In test environment, vscode.workspace might not be available
				this.batchSegmentThreshold = BATCH_SEGMENT_THRESHOLD
			}
		}
	}

	/**
	 * Initializes the file watcher. A second call replaces the previous file system watcher
	 * instead of leaking it (it would keep feeding events into this instance).
	 */
	async initialize(): Promise<void> {
		this.stop()

		// Create file watcher
		const filePattern = new vscode.RelativePattern(
			this.workspacePath,
			`**/*{${scannerExtensions.map((e) => e.substring(1)).join(",")}}`,
		)
		this.fileWatcher = vscode.workspace.createFileSystemWatcher(filePattern)

		// Register event handlers
		this.fileWatcherListeners = [
			this.fileWatcher.onDidCreate(this.handleFileCreated.bind(this)),
			this.fileWatcher.onDidChange(this.handleFileChanged.bind(this)),
			this.fileWatcher.onDidDelete(this.handleFileDeleted.bind(this)),
		]
	}

	/**
	 * Stops watching: disposes the file system watcher and drops pending events. The batch
	 * events stay alive so the orchestrator can start this watcher again after a Stop.
	 */
	stop(): void {
		this.fileWatcherListeners.forEach((listener) => listener.dispose())
		this.fileWatcherListeners = []
		this.fileWatcher?.dispose()
		this.fileWatcher = undefined
		if (this.batchProcessDebounceTimer) {
			clearTimeout(this.batchProcessDebounceTimer)
			this.batchProcessDebounceTimer = undefined
		}
		this.accumulatedEvents.clear()
	}

	/**
	 * Disposes the file watcher for good, including its batch events.
	 */
	dispose(): void {
		this.stop()
		if (this.ownsIgnoreController) {
			this.ignoreController.dispose()
		}
		this._onDidStartBatchProcessing.dispose()
		this._onBatchProgressUpdate.dispose()
		this._onDidFinishBatchProcessing.dispose()
	}

	/**
	 * Handles file creation events
	 * @param uri URI of the created file
	 */
	private async handleFileCreated(uri: vscode.Uri): Promise<void> {
		this.accumulatedEvents.set(uri.fsPath, { uri, type: "create" })
		this.scheduleBatchProcessing()
	}

	/**
	 * Handles file change events
	 * @param uri URI of the changed file
	 */
	private async handleFileChanged(uri: vscode.Uri): Promise<void> {
		this.accumulatedEvents.set(uri.fsPath, { uri, type: "change" })
		this.scheduleBatchProcessing()
	}

	/**
	 * Handles file deletion events
	 * @param uri URI of the deleted file
	 */
	private async handleFileDeleted(uri: vscode.Uri): Promise<void> {
		this.accumulatedEvents.set(uri.fsPath, { uri, type: "delete" })
		this.scheduleBatchProcessing()
	}

	/**
	 * Schedules batch processing with debounce
	 */
	private scheduleBatchProcessing(): void {
		if (this.batchProcessDebounceTimer) {
			clearTimeout(this.batchProcessDebounceTimer)
		}
		this.batchProcessDebounceTimer = setTimeout(() => this.triggerBatchProcessing(), this.BATCH_DEBOUNCE_DELAY_MS)
	}

	/**
	 * Triggers processing of accumulated events
	 */
	private async triggerBatchProcessing(): Promise<void> {
		if (this.accumulatedEvents.size === 0) {
			return
		}

		const eventsToProcess = new Map(this.accumulatedEvents)
		this.accumulatedEvents.clear()

		const filePathsInBatch = Array.from(eventsToProcess.keys())
		this._onDidStartBatchProcessing.fire(filePathsInBatch)

		await this.processBatch(eventsToProcess)
	}

	/**
	 * Processes a batch of accumulated events
	 * @param eventsToProcess Map of events to process
	 */
	private async _handleBatchDeletions(
		batchResults: FileProcessingResult[],
		processedCountInBatch: number,
		totalFilesInBatch: number,
		pathsToExplicitlyDelete: string[],
	): Promise<{ overallBatchError?: Error; processedCount: number }> {
		let overallBatchError: Error | undefined

		// Only deleted files are cleared here. The old points of created/changed files are
		// cleared in _clearPointsOfReindexedFiles, once we know the file is really re-indexed.
		if (pathsToExplicitlyDelete.length > 0 && this.vectorStore) {
			try {
				await this.vectorStore.deletePointsByMultipleFilePaths(pathsToExplicitlyDelete)

				for (const path of pathsToExplicitlyDelete) {
					this.cacheManager.deleteHash(path)
					batchResults.push({ path, status: "success" })
					processedCountInBatch++
					this._onBatchProgressUpdate.fire({
						processedInBatch: processedCountInBatch,
						totalInBatch: totalFilesInBatch,
						currentFile: path,
					})
				}
			} catch (error: any) {
				const errorStatus = error?.status || error?.response?.status || error?.statusCode
				const errorMessage = error instanceof Error ? error.message : String(error)

				// Log telemetry for deletion error
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: sanitizeErrorMessage(errorMessage),
					location: "deletePointsByMultipleFilePaths",
					errorType: "deletion_error",
					errorStatus: errorStatus,
				})

				// Mark all paths as error
				overallBatchError = error as Error
				for (const path of pathsToExplicitlyDelete) {
					batchResults.push({ path, status: "error", error: error as Error })
					processedCountInBatch++
					this._onBatchProgressUpdate.fire({
						processedInBatch: processedCountInBatch,
						totalInBatch: totalFilesInBatch,
						currentFile: path,
					})
				}
			}
		}

		return { overallBatchError, processedCount: processedCountInBatch }
	}

	/**
	 * Deletes the points a file had before it is re-indexed, as the directory scanner does right
	 * before its upsert. Runs after processFile, so a file whose content did not change (skipped)
	 * or whose embedding failed keeps its points, and only for files indexed before: a "change"
	 * event, or any event for a file the cache already knows (e.g. an atomic save seen as create).
	 * @returns The deletion error, if any; the caller then skips the upsert and the hash update
	 */
	private async _clearPointsOfReindexedFiles(
		successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }>,
		filesToUpsertDetails: Array<{ path: string; uri: vscode.Uri; originalType: "create" | "change" }>,
	): Promise<Error | undefined> {
		if (!this.vectorStore) {
			return undefined
		}

		const changedPaths = new Set(
			filesToUpsertDetails.filter((detail) => detail.originalType === "change").map((detail) => detail.path),
		)
		const pathsToClear = successfullyProcessedForUpsert
			.map(({ path }) => path)
			.filter((path) => changedPaths.has(path) || this.cacheManager.getHash(path) !== undefined)

		if (pathsToClear.length === 0) {
			return undefined
		}

		try {
			await this.vectorStore.deletePointsByMultipleFilePaths(pathsToClear)
			return undefined
		} catch (error: any) {
			const errorStatus = error?.status || error?.response?.status || error?.statusCode
			const errorMessage = error instanceof Error ? error.message : String(error)

			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: sanitizeErrorMessage(errorMessage),
				location: "deletePointsByMultipleFilePaths",
				errorType: "deletion_error",
				errorStatus: errorStatus,
			})

			return error instanceof Error ? error : new Error(errorMessage)
		}
	}

	private async _processFilesAndPrepareUpserts(
		filesToUpsertDetails: Array<{ path: string; uri: vscode.Uri; originalType: "create" | "change" }>,
		batchResults: FileProcessingResult[],
		processedCountInBatch: number,
		totalFilesInBatch: number,
		pathsToExplicitlyDelete: string[],
	): Promise<{
		pointsForBatchUpsert: PointStruct[]
		successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }>
		processedCount: number
	}> {
		const pointsForBatchUpsert: PointStruct[] = []
		const successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }> = []
		const filesToProcessConcurrently = [...filesToUpsertDetails]

		for (let i = 0; i < filesToProcessConcurrently.length; i += this.FILE_PROCESSING_CONCURRENCY_LIMIT) {
			const chunkToProcess = filesToProcessConcurrently.slice(i, i + this.FILE_PROCESSING_CONCURRENCY_LIMIT)

			const chunkProcessingPromises = chunkToProcess.map(async (fileDetail) => {
				this._onBatchProgressUpdate.fire({
					processedInBatch: processedCountInBatch,
					totalInBatch: totalFilesInBatch,
					currentFile: fileDetail.path,
				})
				try {
					const result = await this.processFile(fileDetail.path)
					return { path: fileDetail.path, result: result, error: undefined }
				} catch (e) {
					const error = e as Error
					console.error(`[FileWatcher] Unhandled exception processing file ${fileDetail.path}:`, e)
					return { path: fileDetail.path, result: undefined, error: error }
				}
			})

			const settledChunkResults = await Promise.allSettled(chunkProcessingPromises)

			for (const settledResult of settledChunkResults) {
				let resultPath: string | undefined

				if (settledResult.status === "fulfilled") {
					const { path, result, error: directError } = settledResult.value
					resultPath = path

					if (directError) {
						batchResults.push({ path, status: "error", error: directError })
					} else if (result) {
						if (result.status === "skipped" || result.status === "local_error") {
							batchResults.push(result)
						} else if (result.status === "processed_for_batching" && result.pointsToUpsert) {
							pointsForBatchUpsert.push(...result.pointsToUpsert)
							if (result.path && result.newHash) {
								successfullyProcessedForUpsert.push({ path: result.path, newHash: result.newHash })
							} else if (result.path && !result.newHash) {
								successfullyProcessedForUpsert.push({ path: result.path })
							}
						} else {
							batchResults.push({
								path,
								status: "error",
								error: new Error(
									`Unexpected result status from processFile: ${result.status} for file ${path}`,
								),
							})
						}
					} else {
						batchResults.push({
							path,
							status: "error",
							error: new Error(`Fulfilled promise with no result or error for file ${path}`),
						})
					}
				} else {
					const error = settledResult.reason as Error
					const rejectedPath = (settledResult.reason as any)?.path || "unknown"
					console.error("[FileWatcher] A file processing promise was rejected:", settledResult.reason)
					batchResults.push({
						path: rejectedPath,
						status: "error",
						error: error,
					})
				}

				if (!pathsToExplicitlyDelete.includes(resultPath || "")) {
					processedCountInBatch++
				}
				this._onBatchProgressUpdate.fire({
					processedInBatch: processedCountInBatch,
					totalInBatch: totalFilesInBatch,
					currentFile: resultPath,
				})
			}
		}

		return {
			pointsForBatchUpsert,
			successfullyProcessedForUpsert,
			processedCount: processedCountInBatch,
		}
	}

	private async _executeBatchUpsertOperations(
		pointsForBatchUpsert: PointStruct[],
		successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }>,
		batchResults: FileProcessingResult[],
		overallBatchError?: Error,
	): Promise<Error | undefined> {
		if (pointsForBatchUpsert.length > 0 && this.vectorStore && !overallBatchError) {
			try {
				for (let i = 0; i < pointsForBatchUpsert.length; i += this.batchSegmentThreshold) {
					const batch = pointsForBatchUpsert.slice(i, i + this.batchSegmentThreshold)
					let retryCount = 0
					let upsertError: Error | undefined

					while (retryCount < MAX_BATCH_RETRIES) {
						try {
							await this.vectorStore.upsertPoints(batch)
							break
						} catch (error) {
							upsertError = error as Error
							retryCount++
							if (retryCount === MAX_BATCH_RETRIES) {
								// Log telemetry for upsert failure
								TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
									error: sanitizeErrorMessage(upsertError.message),
									location: "upsertPoints",
									errorType: "upsert_retry_exhausted",
									retryCount: MAX_BATCH_RETRIES,
								})
								throw new Error(
									`Failed to upsert batch after ${MAX_BATCH_RETRIES} retries: ${upsertError.message}`,
								)
							}
							await new Promise((resolve) =>
								setTimeout(resolve, INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1)),
							)
						}
					}
				}

				for (const { path, newHash } of successfullyProcessedForUpsert) {
					if (newHash) {
						this.cacheManager.updateHash(path, newHash)
					}
					batchResults.push({ path, status: "success" })
				}
			} catch (error) {
				const err = error as Error
				overallBatchError = overallBatchError || err
				// Log telemetry for batch upsert error
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: sanitizeErrorMessage(err.message),
					location: "executeBatchUpsertOperations",
					errorType: "batch_upsert_error",
					affectedFiles: successfullyProcessedForUpsert.length,
				})
				for (const { path } of successfullyProcessedForUpsert) {
					batchResults.push({ path, status: "error", error: err })
				}
			}
		} else if (overallBatchError) {
			for (const { path } of successfullyProcessedForUpsert) {
				batchResults.push({ path, status: "error", error: overallBatchError })
			}
		}

		return overallBatchError
	}

	private async processBatch(
		eventsToProcess: Map<string, { uri: vscode.Uri; type: "create" | "change" | "delete" }>,
	): Promise<void> {
		const batchResults: FileProcessingResult[] = []
		let processedCountInBatch = 0
		const totalFilesInBatch = eventsToProcess.size
		let overallBatchError: Error | undefined

		// Initial progress update
		this._onBatchProgressUpdate.fire({
			processedInBatch: 0,
			totalInBatch: totalFilesInBatch,
			currentFile: undefined,
		})

		// Categorize events
		const pathsToExplicitlyDelete: string[] = []
		const filesToUpsertDetails: Array<{ path: string; uri: vscode.Uri; originalType: "create" | "change" }> = []

		for (const event of eventsToProcess.values()) {
			if (event.type === "delete") {
				pathsToExplicitlyDelete.push(event.uri.fsPath)
			} else {
				filesToUpsertDetails.push({
					path: event.uri.fsPath,
					uri: event.uri,
					originalType: event.type,
				})
			}
		}

		// Phase 1: Handle deletions
		const { overallBatchError: deletionError, processedCount: deletionCount } = await this._handleBatchDeletions(
			batchResults,
			processedCountInBatch,
			totalFilesInBatch,
			pathsToExplicitlyDelete,
		)
		overallBatchError = deletionError
		processedCountInBatch = deletionCount

		// Phase 2: Process files and prepare upserts
		const {
			pointsForBatchUpsert,
			successfullyProcessedForUpsert,
			processedCount: upsertCount,
		} = await this._processFilesAndPrepareUpserts(
			filesToUpsertDetails,
			batchResults,
			processedCountInBatch,
			totalFilesInBatch,
			pathsToExplicitlyDelete,
		)
		processedCountInBatch = upsertCount

		// Phase 3: Clear the old points of the files that are really re-indexed
		if (!overallBatchError) {
			overallBatchError = await this._clearPointsOfReindexedFiles(
				successfullyProcessedForUpsert,
				filesToUpsertDetails,
			)
		}

		// Phase 4: Execute batch upsert
		overallBatchError = await this._executeBatchUpsertOperations(
			pointsForBatchUpsert,
			successfullyProcessedForUpsert,
			batchResults,
			overallBatchError,
		)

		// Finalize
		this._onDidFinishBatchProcessing.fire({
			processedFiles: batchResults,
			batchError: overallBatchError,
		})
		this._onBatchProgressUpdate.fire({
			processedInBatch: totalFilesInBatch,
			totalInBatch: totalFilesInBatch,
		})

		if (this.accumulatedEvents.size === 0) {
			this._onBatchProgressUpdate.fire({
				processedInBatch: 0,
				totalInBatch: 0,
				currentFile: undefined,
			})
		}
	}

	/**
	 * Processes a file
	 * @param filePath Path to the file to process
	 * @returns Promise resolving to processing result
	 */
	async processFile(filePath: string): Promise<FileProcessingResult> {
		try {
			// Get relative path for ignore checks
			const relativeFilePath = generateRelativeFilePath(filePath, this.workspacePath)

			// Check if file is in an ignored directory
			// Use relative path to avoid matching parent directories outside the workspace
			if (isPathInIgnoredDirectory(relativeFilePath)) {
				return {
					path: filePath,
					status: "skipped" as const,
					reason: "File is in an ignored directory",
				}
			}

			// Check if file should be ignored
			if (
				!this.ignoreController.validateAccess(filePath) ||
				(this.ignoreInstance && this.ignoreInstance.ignores(relativeFilePath))
			) {
				return {
					path: filePath,
					status: "skipped" as const,
					reason: "File is ignored by .rooignore or .gitignore",
				}
			}

			// Check file size
			const fileStat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
			if (fileStat.size > MAX_FILE_SIZE_BYTES) {
				return {
					path: filePath,
					status: "skipped" as const,
					reason: "File is too large",
				}
			}

			// Read file content
			const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
			const content = fileContent.toString()

			// Calculate hash
			const newHash = createHash("sha256").update(content).digest("hex")

			// Check if file has changed
			if (this.cacheManager.getHash(filePath) === newHash) {
				return {
					path: filePath,
					status: "skipped" as const,
					reason: "File has not changed",
				}
			}

			// Parse file
			const blocks = await codeParser.parseFile(filePath, { content, fileHash: newHash })

			// Prepare points for batch processing
			// Points must look exactly like the ones the directory scanner writes (scanner.ts
			// processBatch): same id source, same embedded text, same payload. Otherwise one block
			// gets two different points depending on which component indexed it last.
			let pointsToUpsert: PointStruct[] = []
			const indexableBlocks = blocks.filter((block) => block.content.trim())
			if (this.embedder && indexableBlocks.length > 0) {
				const texts = indexableBlocks.map((block) => block.content.trim())
				const embeddingResponse = await this.embedder.createEmbeddings(texts)
				const { embeddings } = embeddingResponse
				reportEmbeddingUsage(this.embedder, embeddingResponse, "index-watch")

				pointsToUpsert = indexableBlocks.map((block, index) => {
					const normalizedAbsolutePath = generateNormalizedAbsolutePath(block.file_path, this.workspacePath)
					// segmentHash, not "path:start_line": segments of one long line share a start line
					const pointId = uuidv5(block.segmentHash, QDRANT_CODE_BLOCK_NAMESPACE)

					return {
						id: pointId,
						vector: embeddings[index],
						payload: {
							filePath: generateRelativeFilePath(normalizedAbsolutePath, this.workspacePath),
							codeChunk: block.content,
							startLine: block.start_line,
							endLine: block.end_line,
							segmentHash: block.segmentHash,
						},
					}
				})
			}

			return {
				path: filePath,
				status: "processed_for_batching" as const,
				newHash,
				pointsToUpsert,
			}
		} catch (error) {
			return {
				path: filePath,
				status: "local_error" as const,
				error: error as Error,
			}
		}
	}
}
