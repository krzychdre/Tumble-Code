import type { ClineMessage } from "@tumble-code/types"

/** The part of a child task its report notes read. */
export interface ReportingChild {
	clineMessages: readonly ClineMessage[]
}

/**
 * What the parent reads about a delegated child besides the child's own
 * report: the words the user wrote to the child while it worked. Without them
 * a parent takes a child that stopped because the user said so for an
 * interrupted child and starts the work again. "" when there is nothing to add.
 */
export function childReportNotes(child: ReportingChild): string {
	const userMessages = child.clineMessages
		.filter((m) => m.type === "say" && m.say === "user_feedback" && m.text?.trim())
		.map((m) => `<user_message>\n${m.text}\n</user_message>`)
	if (userMessages.length === 0) {
		return ""
	}
	return [
		"The user wrote to this subtask while it worked. These are the user's own words and they apply to you too:",
		...userMessages,
		"Follow them. When the user asked to stop or to pause, do not start new work: tell the user where the work stands.",
	].join("\n\n")
}
