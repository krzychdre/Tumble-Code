import path from "path"

import { type ClineSayTool, DEFAULT_WRITE_DELAY_MS, SETTINGS_DEFAULTS } from "@roo-code/types"

import { getReadablePath } from "../../../utils/path"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import type { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import type { RecordSource } from "../../context-tracking/FileContextTrackerTypes"
import { EXPERIMENT_IDS, experiments } from "../../../shared/experiments"
import { sanitizeUnifiedDiff, computeDiffStats } from "../../diff/stats"
import { pauseForPlanReviewIfNeeded } from "../../plan-review/planReviewPause"
import type { ToolCallbacks } from "../BaseTool"

import { pushToolWriteResult } from "./toolWriteResult"

/** Settings the save step needs, read once per edit. */
export interface EditSaveContext {
	/** True when the edit is written straight to disk without a diff editor. */
	writesDirectly: boolean
	diagnosticsEnabled: boolean
	writeDelayMs: number
}

export interface ComputedEditOptions {
	/** Content before the edit; `undefined` for a file that does not exist yet. */
	originalContent: string | undefined
	/** The edit creates the file. Default: false. */
	isNewFile?: boolean
	/** Card type of the approval message. Default: "appliedDiff". */
	cardTool?: "appliedDiff" | "newFileCreated"
	/** Also send the original content in the approval card (apply_patch update). */
	cardIncludesOriginalContent?: boolean
	/** Text appended to the write result, before the plan-review note. */
	resultSuffix?: string
	/** Path the plan-review gate checks. Default: `relPath`. */
	reviewRelPath?: string
	/** Called before the "No changes needed" result when the diff is empty. */
	onNoChanges?: () => Promise<void>
	/**
	 * Replaces the default save (diff view save or direct write, then file
	 * tracking). Return false to stop: the hook has already reported the
	 * outcome to the model and reset the diff view.
	 */
	save?: (context: EditSaveContext) => Promise<boolean>
}

/**
 * - "saved": written, the write result was pushed; the caller still resets the
 *   diff view, records tool usage and processes queued messages.
 * - "rejected", "unchanged", "aborted": the result was pushed and the diff view
 *   was reset; nothing was written.
 */
export type ComputedEditOutcome = "saved" | "rejected" | "unchanged" | "aborted"

/**
 * The approval, diff view and save sequence every edit tool runs once it has
 * computed the new file content (CORE-R8). One copy, so the direct-write rule
 * (`task.silentWrites` or the focus-disruption experiment), the approval card
 * and the post-save plan-review gate cannot drift between tools again.
 *
 * Order: diff view setup, empty-diff check, settings, approval card, diff
 * editor (unless writing directly), approval, save, file tracking, write
 * result, plan-review gate, result. Errors propagate to the caller's
 * `handleError`.
 */
export async function applyComputedEdit(
	task: Task,
	relPath: string,
	newContent: string,
	callbacks: Pick<ToolCallbacks, "askApproval" | "pushToolResult" | "toolCallId">,
	options: ComputedEditOptions,
): Promise<ComputedEditOutcome> {
	const { askApproval, pushToolResult, toolCallId } = callbacks
	const { originalContent, isNewFile = false } = options

	task.diffViewProvider.originalContent = originalContent

	const diff = formatResponse.createPrettyPatch(relPath, originalContent ?? "", newContent)
	if (!diff && !isNewFile) {
		await options.onNoChanges?.()
		pushToolResult(`No changes needed for '${relPath}'`)
		await task.diffViewProvider.reset()
		return "unchanged"
	}

	const state = await task.providerRef.deref()?.getState()
	const diagnosticsEnabled = state?.diagnosticsEnabled ?? SETTINGS_DEFAULTS.diagnosticsEnabled
	const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS
	// Background/memory tasks (`silentWrites`) reuse the focus-disruption
	// path: it writes straight to disk without opening a diff editor tab.
	const writesDirectly =
		task.silentWrites || experiments.isEnabled(state?.experiments ?? {}, EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION)

	const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false
	const sanitizedDiff = sanitizeUnifiedDiff(diff || "")
	const diffStats = computeDiffStats(sanitizedDiff) || undefined

	const sharedMessageProps: ClineSayTool = {
		tool: options.cardTool ?? "appliedDiff",
		path: getReadablePath(task.cwd, relPath),
		diff: sanitizedDiff,
		// Undefined values are dropped by JSON.stringify, so the key only
		// appears in the card when asked for.
		originalContent: options.cardIncludesOriginalContent ? originalContent : undefined,
		isOutsideWorkspace: isPathOutsideWorkspace(path.resolve(task.cwd, relPath)),
		// Stamp the native tool-call id so the finalized-duplicate dedup
		// links this complete card to its streaming placeholder.
		toolCallId,
	}

	const completeMessage = JSON.stringify({
		...sharedMessageProps,
		content: sanitizedDiff,
		isProtected: isWriteProtected,
		diffStats,
	} satisfies ClineSayTool)

	if (!writesDirectly) {
		await task.diffViewProvider.open(relPath, isNewFile ? "create" : "modify")
		await task.diffViewProvider.update(newContent, true)
		task.diffViewProvider.scrollToFirstDiff()
	}

	const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

	if (!didApprove) {
		if (!writesDirectly) {
			await task.diffViewProvider.revertChanges()
		}
		pushToolResult("Changes were rejected by the user.")
		await task.diffViewProvider.reset()
		return "rejected"
	}

	const saveContext: EditSaveContext = { writesDirectly, diagnosticsEnabled, writeDelayMs }
	if (options.save) {
		if (!(await options.save(saveContext))) {
			return "aborted"
		}
	} else {
		if (writesDirectly) {
			await task.diffViewProvider.saveDirectly(relPath, newContent, isNewFile, diagnosticsEnabled, writeDelayMs)
		} else {
			await task.diffViewProvider.saveChanges(diagnosticsEnabled, writeDelayMs)
		}
		await task.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
	}

	task.didEditFile = true

	const message = await pushToolWriteResult(task, isNewFile)
	const reviewNote = await pauseForPlanReviewIfNeeded(task, options.reviewRelPath ?? relPath)
	pushToolResult(message + (options.resultSuffix ?? "") + (reviewNote ? `\n\n${reviewNote}` : ""))
	return "saved"
}
