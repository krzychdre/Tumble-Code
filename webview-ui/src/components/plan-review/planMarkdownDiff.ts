import { diffArrays } from "diff"

export type PlanDiffSegment =
	/** Rendered as markdown; `changed` segments get the inserted-diff tint. */
	| { kind: "same" | "changed"; markdown: string }
	/** Content that existed in the baseline but is gone — rendered as a
	 * struck-through plain-text strip (markdown rendering of deleted content
	 * would be misleading next to the live document). */
	| { kind: "removed"; text: string }

/**
 * Splits markdown into blank-line-delimited blocks, keeping fenced code blocks
 * (which may contain blank lines) intact so a block is always independently
 * renderable.
 */
export function splitMarkdownBlocks(markdown: string): string[] {
	const lines = markdown.split("\n")
	const blocks: string[] = []
	let current: string[] = []
	let inFence = false
	let fenceMarker = ""

	const flush = () => {
		if (current.length > 0) {
			blocks.push(current.join("\n"))
			current = []
		}
	}

	for (const line of lines) {
		const fenceMatch = line.match(/^\s*(```+|~~~+)/)
		if (fenceMatch) {
			if (!inFence) {
				inFence = true
				fenceMarker = fenceMatch[1][0].repeat(3)
			} else if (fenceMatch[1].startsWith(fenceMarker)) {
				inFence = false
			}
			current.push(line)
			continue
		}

		if (!inFence && line.trim() === "") {
			flush()
			continue
		}

		current.push(line)
	}
	flush()

	return blocks
}

/**
 * Block-level diff of two markdown documents for the plan-review rendered
 * preview. Returns the CURRENT document as ordered segments: unchanged blocks,
 * changed/added blocks (highlighted), and strips marking removed baseline
 * content. Consecutive segments of the same kind are merged.
 */
export function diffPlanMarkdown(baseline: string | undefined, current: string): PlanDiffSegment[] {
	if (baseline === undefined || baseline === current) {
		return current ? [{ kind: "same", markdown: current }] : []
	}

	const oldBlocks = splitMarkdownBlocks(baseline)
	const newBlocks = splitMarkdownBlocks(current)

	const parts = diffArrays(oldBlocks, newBlocks, {
		// Whitespace-insensitive comparison so reflowed text isn't flagged.
		comparator: (a, b) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim(),
	})

	const segments: PlanDiffSegment[] = []

	const push = (segment: PlanDiffSegment) => {
		const last = segments[segments.length - 1]
		if (last && last.kind === segment.kind) {
			if (last.kind === "removed") {
				last.text += "\n" + (segment as { kind: "removed"; text: string }).text
			} else {
				last.markdown += "\n\n" + (segment as { kind: "same" | "changed"; markdown: string }).markdown
			}
			return
		}
		segments.push(segment)
	}

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]

		if (part.added) {
			push({ kind: "changed", markdown: part.value.join("\n\n") })
		} else if (part.removed) {
			// A removal directly followed by an addition is a modification —
			// the addition is already highlighted, so drop the removed strip
			// to avoid showing every edited paragraph twice.
			const next = parts[i + 1]
			if (next?.added) {
				continue
			}
			push({ kind: "removed", text: part.value.join("\n\n") })
		} else {
			push({ kind: "same", markdown: part.value.join("\n\n") })
		}
	}

	return segments
}
