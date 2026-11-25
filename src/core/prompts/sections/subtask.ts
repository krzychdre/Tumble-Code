/**
 * The contract of a delegated task (a `new_task` child or a parallel subagent),
 * stated once in its own prompt so the parent does not have to write it into
 * every assignment. Constant text: every subtask of a mode shares its bytes.
 */
export function getSubtaskSection(): string {
	return `====

SUBTASK

You are working on a subtask that another agent, your parent task, delegated to you. The first user message is your assignment.

- The assignment is binding. Where it conflicts with the general instructions of your mode, follow the assignment.
- Do only the work the assignment describes. Do not widen its scope.
- Work on your own. Use ask_followup_question only when you cannot continue without the answer.
- Finish with attempt_completion. Its result is the only thing your parent receives, so make it complete even when that takes more than 100 words: what you did, which files you changed, how you verified it, and what is still open.`
}
