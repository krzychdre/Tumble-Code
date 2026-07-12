import * as vscode from "vscode"
import delay from "delay"

import { DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"

import { diagnosticsToProblemsString, getNewDiagnostics } from "../diagnostics"
import { Task } from "../../core/task/Task"

/**
 * Owns the pre/post-edit diagnostics capture and comparison flow.
 *
 * The collector snapshots VS Code diagnostics before an edit (`capturePreDiagnostics`)
 * and, after the edit is persisted, compares the snapshot against the current
 * diagnostics to produce a `newProblemsMessage` string describing only the
 * problems that are new — i.e. introduced by the edit and not already present
 * at snapshot time.
 *
 * Extracted from DiffViewProvider so the diagnostics orchestration is
 * unit-testable without constructing a full provider + diff editor.
 */
export class DiagnosticsCollector {
	private cwd: string
	private taskRef: WeakRef<Task>

	constructor(cwd: string, task: Task) {
		this.cwd = cwd
		this.taskRef = new WeakRef(task)
	}

	/**
	 * Snapshot the current VS Code diagnostics. Called before the edit is
	 * applied so `collectPostSaveDiagnostics` can diff against it.
	 */
	capturePreDiagnostics(): [vscode.Uri, vscode.Diagnostic[]][] {
		return vscode.languages.getDiagnostics()
	}

	/**
	 * After the edit has been persisted to disk, optionally wait for linters
	 * to settle, then compare the current diagnostics against the pre-edit
	 * snapshot and format a human-readable message listing only the new errors.
	 *
	 * Returns `""` when diagnostics are disabled or no new problems are found.
	 */
	async collectPostSaveDiagnostics(
		preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] | undefined,
		diagnosticsEnabled: boolean,
		writeDelayMs: number = DEFAULT_WRITE_DELAY_MS,
	): Promise<string> {
		let newProblemsMessage = ""

		if (diagnosticsEnabled) {
			// Add configurable delay to allow linters time to process and clean up issues
			// like unused imports (especially important for Go and other languages)
			// Ensure delay is non-negative
			const safeDelayMs = Math.max(0, writeDelayMs)

			try {
				await delay(safeDelayMs)
			} catch (error) {
				// Log error but continue - delay failure shouldn't break the save operation
				console.warn(`Failed to apply write delay: ${error}`)
			}

			const postDiagnostics = vscode.languages.getDiagnostics()

			// Get diagnostic settings from state
			const task = this.taskRef.deref()
			const state = await task?.providerRef.deref()?.getState()
			const includeDiagnosticMessages = state?.includeDiagnosticMessages ?? true
			const maxDiagnosticMessages = state?.maxDiagnosticMessages ?? 50

			const newProblems = await diagnosticsToProblemsString(
				getNewDiagnostics(preDiagnostics ?? [], postDiagnostics),
				[
					vscode.DiagnosticSeverity.Error, // only including errors since warnings can be distracting (if user wants to fix warnings they can use the @problems mention)
				],
				this.cwd,
				includeDiagnosticMessages,
				maxDiagnosticMessages,
			) // Will be empty string if no errors.

			newProblemsMessage =
				newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""
		}

		return newProblemsMessage
	}
}
