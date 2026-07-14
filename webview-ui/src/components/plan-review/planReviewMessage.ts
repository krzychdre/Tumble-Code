export interface PlanAnnotation {
	id: string
	quote: string
	note: string
}

/**
 * Compile plan-review annotations into a single plain-text message
 * suitable for sending to the LLM. Always English (not i18n) so weak
 * models can parse it reliably.
 */
export function compilePlanReviewMessage(
	annotations: PlanAnnotation[],
	overallComment: string,
	filePath?: string,
): string {
	// Defensive: filter out annotations with empty quote or note after trim.
	const valid = annotations.filter((a) => a.quote.trim().length > 0 && a.note.trim().length > 0)

	const parts: string[] = []

	if (valid.length > 0) {
		if (filePath) {
			parts.push(
				`I reviewed the plan in \`${filePath}\` and added notes on specific parts. Each quoted block is the part of the plan the note refers to.`,
			)
		} else {
			parts.push(
				"I reviewed the plan and added notes on specific parts. Each quoted block is the part of the plan the note refers to.",
			)
		}

		for (const ann of valid) {
			// Normalize line endings and trim.
			const quote = ann.quote.replace(/\r\n/g, "\n").trim()
			// Prefix every line with "> ".
			const blockquoted = quote
				.split("\n")
				.map((line) => `> ${line}`)
				.join("\n")

			parts.push("")
			parts.push(blockquoted)
			parts.push("")
			parts.push(`Note: ${ann.note.trim()}`)
		}
	}

	if (overallComment.trim().length > 0) {
		parts.push("")
		parts.push(`Overall: ${overallComment.trim()}`)
	}

	parts.push("")
	parts.push("Please address these notes and update the plan.")

	return parts.join("\n")
}
