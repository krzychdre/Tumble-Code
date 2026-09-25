import { parsePatch } from "diff"

export interface DiffLine {
	oldLineNum: number | null
	newLineNum: number | null
	type: "context" | "addition" | "deletion" | "gap"
	content: string
	hiddenCount?: number
}

/**
 * parsePatch, retried without empty lines when it rejects the patch.
 *
 * The extension's sanitizeUnifiedDiff blanks the "\ No newline at end of file"
 * marker out of the patches it sends instead of deleting the line, and chat
 * history keeps those patches. jsdiff 5 counted the empty line as a context
 * row; jsdiff 6+ checks the hunk line counts and throws, which rendered no
 * diff at all for any edit of a file without a trailing newline. The retry
 * only runs after a strict parse failed, so well-formed patches are parsed
 * exactly as before. Keep in sync with src/core/diff/stats.ts.
 */
function parsePatchTolerant(source: string): ReturnType<typeof parsePatch> {
	try {
		return parsePatch(source)
	} catch (error) {
		const withoutEmptyLines = source.replace(/\r?\n(?=\r?\n|$)/g, "")
		if (withoutEmptyLines === source) throw error
		return parsePatch(withoutEmptyLines + "\n")
	}
}

/**
 * Parse a unified diff string into a flat list of renderable lines with
 * line numbers, addition/deletion/context flags, and compact "gap" separators
 * between hunks.
 */
export function parseUnifiedDiff(source: string, filePath?: string): DiffLine[] {
	if (!source) return []

	try {
		const patches = parsePatchTolerant(source)
		if (!patches || patches.length === 0) return []

		const patch = filePath
			? (patches.find((p) =>
					[p.newFileName, p.oldFileName].some(
						(n) => typeof n === "string" && (n === filePath || (n as string).endsWith("/" + filePath)),
					),
				) ?? patches[0])
			: patches[0]

		if (!patch) return []

		const lines: DiffLine[] = []
		let prevHunk: any = null
		for (const hunk of (patch as any).hunks || []) {
			// Insert a compact "hidden lines" separator between hunks
			if (prevHunk) {
				const gapNew = hunk.newStart - (prevHunk.newStart + prevHunk.newLines)
				const gapOld = hunk.oldStart - (prevHunk.oldStart + prevHunk.oldLines)
				const hidden = Math.max(gapNew, gapOld)
				if (hidden > 0) {
					lines.push({
						oldLineNum: null,
						newLineNum: null,
						type: "gap",
						content: "",
						hiddenCount: hidden,
					})
				}
			}

			let oldLine = hunk.oldStart
			let newLine = hunk.newStart

			for (const raw of hunk.lines || []) {
				const firstChar = (raw as string)[0]
				// jsdiff 6+ keeps the "\r" of CRLF patches on each line (5.x split it off).
				const content = (raw as string).slice(1).replace(/\r$/, "")

				if (firstChar === "-") {
					lines.push({
						oldLineNum: oldLine,
						newLineNum: null,
						type: "deletion",
						content,
					})
					oldLine++
				} else if (firstChar === "+") {
					lines.push({
						oldLineNum: null,
						newLineNum: newLine,
						type: "addition",
						content,
					})
					newLine++
				} else {
					// Context line
					lines.push({
						oldLineNum: oldLine,
						newLineNum: newLine,
						type: "context",
						content,
					})
					oldLine++
					newLine++
				}
			}

			prevHunk = hunk
		}

		return lines
	} catch {
		// swallow parse errors and render nothing rather than breaking the UI
		return []
	}
}
