import { findLast } from "@tumble-code/core/browser"
import type { ClineMessage, TodoItem } from "@tumble-code/types"

/** The part of a child task its report notes read. */
export interface ReportingChild {
	clineMessages: readonly ClineMessage[]
	todoList?: readonly TodoItem[]
	/** The task reached its context limit and was told to hand over (TaskApiLoop.handleSubtaskContextLimit). */
	contextHandoff: boolean
}

/** The child's last finished chat text: its last words when it stops without attempt_completion. */
export function lastSayText(messages: ClineMessage[]): string | undefined {
	return findLast(messages, (m) => m.type === "say" && m.say === "text" && !m.partial && !!m.text?.trim())?.text
}

/**
 * What the parent reads about a delegated child besides the child's own
 * report: the words the user wrote to the child while it worked, and that the
 * child handed over at its context limit with the TODO items it left open.
 * Without them a parent takes a child that stopped because the user said so,
 * or because its context filled up, for an interrupted child and either starts
 * the same work again or misses what is left. "" when there is nothing to add.
 */
export function childReportNotes(child: ReportingChild): string {
	return [userMessagesNote(child), handoffNote(child)].filter(Boolean).join("\n\n")
}

function userMessagesNote(child: ReportingChild): string {
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

function handoffNote(child: ReportingChild): string {
	if (!child.contextHandoff) {
		return ""
	}
	const open = (child.todoList ?? []).filter((todo) => todo.status !== "completed").map((t) => `- ${t.content}`)
	return [
		"This subtask's context window filled up, so it handed its work over. This is planned, not a failure: " +
			"its report says what is done.",
		...(open.length > 0 ? ["TODO items it left open:", open.join("\n")] : []),
		"Start a new subtask for the work that is left and give it this report. Do not redo the finished work.",
	].join("\n\n")
}
