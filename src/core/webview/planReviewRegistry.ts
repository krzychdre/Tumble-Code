import { arePathsEqual } from "../../utils/path"

/**
 * Tracks files currently open in a Plan Review panel so the auto-approval
 * layer can force manual approval on model edits to a plan the user is
 * actively reviewing. Kept as a dependency-free singleton to avoid an import
 * cycle between core/auto-approval and core/webview.
 */
const openPlanReviewFiles = new Set<string>()

export function registerPlanReviewFile(fsPath: string): void {
	openPlanReviewFiles.add(fsPath)
}

export function unregisterPlanReviewFile(fsPath: string): void {
	openPlanReviewFiles.delete(fsPath)
}

export function hasOpenPlanReviewFiles(): boolean {
	return openPlanReviewFiles.size > 0
}

export function isPlanReviewFileOpen(fsPath: string | undefined): boolean {
	if (!fsPath) {
		return false
	}

	for (const open of openPlanReviewFiles) {
		if (arePathsEqual(open, fsPath)) {
			return true
		}
	}

	return false
}
