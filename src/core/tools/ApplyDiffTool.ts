import path from "path"
import fs from "fs/promises"

import { type ClineSayTool, TelemetryEventName } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { getReadablePath } from "../../utils/path"
import { Task } from "../task/Task"
import { ignorePartialAskRejection } from "../task/AskIgnoredError"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import type { DiffResult, ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"
import { applyComputedEdit } from "./helpers/applyComputedEdit"

interface ApplyDiffParams {
	path: string
	diff: string
}

/** Longest best-match excerpt shown for a failed block after the first one. */
const MAX_BEST_MATCH_CHARS = 2000

type FailPart = Extract<DiffResult, { success: false }>

function failedOnly(failParts: DiffResult[]): FailPart[] {
	return failParts.filter((part): part is FailPart => !part.success)
}

/** "Block 2 of 3 (:start_line:145)", or "Block 2" when the strategy did not say where the block was. */
function blockLabel(part: FailPart, fallbackIndex: number, blockCount: number | undefined): string {
	const index = part.blockIndex ?? fallbackIndex
	const of = blockCount ? ` of ${blockCount}` : ""
	return `Block ${index}${of}${part.startLine ? ` (:start_line:${part.startLine})` : ""}`
}

/** The one-line reason and the best match of a failure, without the search text and file dump. */
function shortFailure(error: string): string {
	const reason = error.split("\n")[0]
	const bestMatchStart = error.indexOf("\n\nBest Match Found:\n")
	if (bestMatchStart === -1) {
		return reason
	}
	const bestMatchEnd = error.indexOf("\n\nOriginal Content:", bestMatchStart)
	let bestMatch = error.slice(bestMatchStart + 2, bestMatchEnd === -1 ? undefined : bestMatchEnd)
	if (bestMatch.length > MAX_BEST_MATCH_CHARS) {
		bestMatch = `${bestMatch.slice(0, MAX_BEST_MATCH_CHARS)}\n... (shortened)`
	}
	return `${reason}\n${bestMatch}`
}

/**
 * Every failed block, in the order of the model's diff. Only the first one
 * keeps the full debug text (search content and original file lines, which
 * can be the whole file); the others get the reason and the best match.
 */
function formatFailedBlocks(failParts: DiffResult[], blockCount: number | undefined): string {
	const failed = failedOnly(failParts)
		.map((part, i) => ({ part, label: blockLabel(part, i + 1, blockCount) }))
		.sort((a, b) => (a.part.blockIndex ?? 0) - (b.part.blockIndex ?? 0))
	const sections = failed.map(({ part, label }, i) => {
		const error = part.error ?? "Unknown error"
		if (i > 0) {
			return `${label} failed:\n${shortFailure(error)}`
		}
		const details = part.details ? JSON.stringify(part.details, null, 2) : ""
		return `${label} failed:\n${error}${details ? `\n\nDetails:\n${details}` : ""}`
	})
	return `<error_details>\n${sections.join("\n\n")}\n</error_details>`
}

/** Block numbers for a sentence: "block 2", "blocks 2 and 3", "blocks 1, 2 and 4". */
function listBlocks(numbers: number[]): string {
	return numbers.length <= 1
		? `block ${numbers.join("")}`
		: `blocks ${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`
}

/**
 * Text around the write result when only some blocks applied: which blocks
 * are now in the file (must not be sent again) and which failed. Weak models
 * re-sent applied blocks when they were only told "unable to apply all diff parts".
 */
function partialApplyReport(
	absolutePath: string,
	failParts: DiffResult[],
	blockCount: number | undefined,
): { prefix: string; suffix: string } {
	const failedParts = failedOnly(failParts)
	const failedIndexes = failedParts
		.map((part) => part.blockIndex)
		.filter((index): index is number => typeof index === "number")
		.sort((a, b) => a - b)
	const details = formatFailedBlocks(failParts, blockCount)
	const next =
		"Next step: use read_file to read the current lines of the failed blocks (line numbers may have changed). " +
		"Then send one new apply_diff with ONLY the failed blocks, fixed."

	if (!blockCount || failedIndexes.length !== failedParts.length) {
		return {
			prefix: `Partially applied the diff to file: ${absolutePath}. ${failedParts.length} block(s) failed.\n`,
			suffix:
				`\n\nThe other blocks were applied. The file already contains them. Do NOT send them again.\n${next}\n\n` +
				details,
		}
	}

	const appliedIndexes = Array.from({ length: blockCount }, (_, i) => i + 1).filter(
		(index) => !failedIndexes.includes(index),
	)
	const applied = listBlocks(appliedIndexes)
	const failed = listBlocks(failedIndexes)
	return {
		prefix: `Partially applied the diff to file: ${absolutePath}. ${appliedIndexes.length} of ${blockCount} blocks applied, ${failedIndexes.length} failed.\n`,
		suffix:
			`\n\nApplied: ${applied}. The file already contains these changes. Do NOT send ${applied} again.\n` +
			`Failed: ${failed}. These changes are NOT in the file.\n${next}\n\n` +
			details,
	}
}

export class ApplyDiffTool extends BaseTool<"apply_diff"> {
	readonly name = "apply_diff" as const

	async execute(params: ApplyDiffParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		const { path: relPath, diff: diffContent } = params

		try {
			if (!relPath) {
				this.recordFailure(task, "apply_diff")
				pushToolResult(await task.sayAndCreateMissingParamError("apply_diff", "path"))
				return
			}

			if (!diffContent) {
				this.recordFailure(task, "apply_diff")
				pushToolResult(await task.sayAndCreateMissingParamError("apply_diff", "diff"))
				return
			}

			const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

			if (!accessAllowed) {
				await task.say("rooignore_error", relPath)
				pushToolResult(formatResponse.rooIgnoreError(relPath))
				return
			}

			const absolutePath = path.resolve(task.cwd, relPath)
			const fileExists = await fileExistsAtPath(absolutePath)

			if (!fileExists) {
				this.recordFailure(task, "apply_diff")
				const formattedError = `File does not exist at path: ${absolutePath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path and try again.\n</error_details>`
				await task.say("error", formattedError)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formattedError)
				return
			}

			const originalContent: string = await fs.readFile(absolutePath, "utf-8")

			// Apply the diff to the original content
			const startLineMatch = params.diff.match(/:start_line:(\d+)/)
			const startLine = startLineMatch ? parseInt(startLineMatch[1], 10) : undefined
			const diffResult = await task.diffStrategy.applyDiff(originalContent, diffContent, startLine)

			if (!diffResult.success) {
				task.consecutiveMistakeCount++
				const currentCount = (task.consecutiveMistakeCountForApplyDiff.get(relPath) || 0) + 1
				task.consecutiveMistakeCountForApplyDiff.set(relPath, currentCount)
				let formattedError = ""
				TelemetryService.instance.capture(TelemetryEventName.DIFF_APPLICATION_ERROR, {
					taskId: task.taskId,
					consecutiveMistakeCount: currentCount,
				})

				if (diffResult.failParts && diffResult.failParts.length > 0) {
					const { blockCount } = diffResult
					const nothingApplied =
						blockCount === 1
							? "The diff block was not applied."
							: blockCount
								? `None of the ${blockCount} diff blocks were applied.`
								: "No diff block was applied."
					formattedError = `Unable to apply diff to file: ${absolutePath}\n${nothingApplied} The file is unchanged.\n\n${formatFailedBlocks(
						diffResult.failParts,
						blockCount,
					)}`
				} else {
					const errorDetails = diffResult.details ? JSON.stringify(diffResult.details, null, 2) : ""

					formattedError = `Unable to apply diff to file: ${absolutePath}\n\n<error_details>\n${
						diffResult.error
					}${errorDetails ? `\n\nDetails:\n${errorDetails}` : ""}\n</error_details>`
				}

				if (currentCount >= 2) {
					await task.say("diff_error", formattedError)
				}

				task.recordToolError("apply_diff", formattedError)

				pushToolResult(formattedError)
				return
			}

			task.consecutiveMistakeCount = 0
			task.consecutiveMistakeCountForApplyDiff.delete(relPath)

			const block: ToolUse<"apply_diff"> = {
				type: "tool_use",
				name: "apply_diff",
				params: { path: relPath, diff: diffContent },
				partial: false,
			}

			// Check for single SEARCH/REPLACE block warning
			const searchBlocks = (diffContent.match(/<<<<<<< SEARCH/g) || []).length
			const singleBlockNotice =
				searchBlocks === 1
					? "\n<notice>Making multiple related changes in a single apply_diff is more efficient. If other changes are needed in this file, please include them as additional SEARCH/REPLACE blocks.</notice>"
					: ""

			const partial =
				diffResult.failParts && diffResult.failParts.length > 0
					? partialApplyReport(absolutePath, diffResult.failParts, diffResult.blockCount)
					: undefined

			const outcome = await applyComputedEdit(task, relPath, diffResult.content, callbacks, {
				originalContent,
				cardIncludesOriginalContent: true,
				cardDiff: diffContent,
				progressStatus: task.diffStrategy.getProgressStatus(block, diffResult),
				resultPrefix: partial?.prefix ?? "",
				resultSuffix: (partial?.suffix ?? "") + singleBlockNotice,
			})

			if (outcome !== "rejected") {
				await task.diffViewProvider.reset()
				this.resetPartialState(task)
			}

			// Process any queued messages after file edit completes
			task.processQueuedMessages()

			return
		} catch (error) {
			await handleError("applying diff", error as Error, this.name)
			await task.diffViewProvider.reset()
			this.resetPartialState(task)
			task.processQueuedMessages()
			return
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"apply_diff">): Promise<void> {
		const relPath: string | undefined = block.params.path
		const diffContent: string | undefined = block.params.diff

		// Wait for path to stabilize before showing UI (prevents truncated paths)
		if (!this.hasPathStabilized(task, relPath)) {
			return
		}

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: getReadablePath(task.cwd, relPath),
			diff: diffContent,
			// Stamp the native tool-call id so this placeholder links to the
			// later complete card under the finalized-duplicate dedup.
			toolCallId: block.id,
		}

		const toolProgressStatus = task.diffStrategy.getProgressStatus(block)

		if (toolProgressStatus && Object.keys(toolProgressStatus).length === 0) {
			return
		}

		await task
			.ask("tool", JSON.stringify(sharedMessageProps), block.partial, toolProgressStatus)
			.catch(ignorePartialAskRejection)
	}
}

export const applyDiffTool = new ApplyDiffTool()
