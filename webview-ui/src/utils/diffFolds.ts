import type { DiffLine } from "./parseUnifiedDiff"

/**
 * Unchanged-line folding for the diff view (§2.7,
 * ai_plans/2026-09-27_ui-modernization.md).
 *
 * A run of more than FOLD_THRESHOLD unchanged (context) lines inside a hunk
 * keeps FOLD_CONTEXT lines next to each neighbouring change and folds the rest
 * into one "... N unchanged lines" row. A hunk separator ("gap") or the start
 * or end of the hunk is a boundary, not a change, so no context is kept on
 * that side. A fold that would hide a single line is not worth a row, so it
 * is shown instead.
 */
const FOLD_THRESHOLD = 6
const FOLD_CONTEXT = 3
const MIN_FOLDED_LINES = 2

export type DiffRenderRow =
	| { kind: "line"; hunkIndex: number; lineIndex: number }
	| { kind: "fold"; key: string; hunkIndex: number; count: number }

const isChange = (line: DiffLine | undefined) => line?.type === "addition" || line?.type === "deletion"

/**
 * Flattens hunks into the rows to render, replacing each folded run with a
 * fold row. `expandedFolds` holds the keys of the folds the user opened; their
 * lines render as ordinary rows. Keys are stable for a given diff source.
 */
export function buildDiffRenderRows(
	hunks: ReadonlyArray<{ lines: DiffLine[] }>,
	expandedFolds: ReadonlySet<string>,
): DiffRenderRow[] {
	const rows: DiffRenderRow[] = []

	hunks.forEach(({ lines }, hunkIndex) => {
		let index = 0
		while (index < lines.length) {
			if (lines[index].type !== "context") {
				rows.push({ kind: "line", hunkIndex, lineIndex: index })
				index++
				continue
			}

			const start = index
			while (index < lines.length && lines[index].type === "context") index++
			const end = index // exclusive

			const keepHead = isChange(lines[start - 1]) ? FOLD_CONTEXT : 0
			const keepTail = isChange(lines[end]) ? FOLD_CONTEXT : 0
			const foldStart = start + keepHead
			const foldEnd = end - keepTail
			const key = `${hunkIndex}:${foldStart}`
			const folded =
				end - start > FOLD_THRESHOLD && foldEnd - foldStart >= MIN_FOLDED_LINES && !expandedFolds.has(key)

			for (let lineIndex = start; lineIndex < end; lineIndex++) {
				if (folded && lineIndex === foldStart) {
					rows.push({ kind: "fold", key, hunkIndex, count: foldEnd - foldStart })
				}
				if (folded && lineIndex >= foldStart && lineIndex < foldEnd) continue
				rows.push({ kind: "line", hunkIndex, lineIndex })
			}
		}
	})

	return rows
}

/** Added and removed line counts of a parsed diff, for the file header. */
export function countDiffStats(lines: ReadonlyArray<DiffLine>): { added: number; removed: number } {
	let added = 0
	let removed = 0
	for (const line of lines) {
		if (line.type === "addition") added++
		else if (line.type === "deletion") removed++
	}
	return { added, removed }
}

/**
 * The one line number shown in the merged gutter (narrow panels): the old
 * number for a deletion, the new number for an addition or a context line.
 */
export function mergedLineNumber(line: DiffLine): number | null {
	if (line.type === "deletion") return line.oldLineNum
	return line.newLineNum ?? line.oldLineNum
}
