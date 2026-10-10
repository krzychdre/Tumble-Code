/**
 * The constant part of the compact system prompt (compact profile, workstream A,
 * ai_plans/2026-10-10_20-07_compact-a-prompt.md).
 *
 * Audience: a 4B model quantized to 4 bits, served by llama.cpp with a
 * 40,960-token window. It reads and answers well but gets lost in long
 * instructions and in complex tool formats. Its recorded failure: asked to add
 * two coffees for today to a markdown diary, it appended rows under yesterday's
 * table and reported success. So the text below is short imperative sentences,
 * one concrete example (the dated-entry edit), and no hedging or repetition.
 *
 * KV cache: every section in this file is part of the COMPACT STABLE HEAD. The
 * bytes are constants, the same for every mode, so a mode switch keeps the
 * cached prefix. Every claim must therefore hold in every mode: the text names
 * tools only as the way to do a job, and the TOOLS IN THIS MODE section in the
 * tail says what a mode lacks. Nothing that depends on the mode, the model or
 * the request may be added here; see CONTRIBUTING.md, "KV-cache contract".
 *
 * The tool behaviour described here follows the compact contract shared with
 * workstreams B and C: read_file shows raw lines without line numbers and tells
 * the model the next offset when it truncates; edit takes file_path,
 * old_string, new_string and an optional replace_all, and old_string must match
 * exactly once.
 */

/**
 * The first bytes of every compact prompt. Both sections it names render in
 * every mode: MODE for every schema-valid mode, USER'S CUSTOM INSTRUCTIONS
 * because the Language Preference entry is always present (see the guard in
 * `prefix-stability.spec.ts`).
 */
export const COMPACT_PROMPT_OPENER = `You are Tumble Code, an AI agent. You work in the user's workspace through tools. The MODE section below gives your role. Follow it and the USER'S CUSTOM INSTRUCTIONS.`

/** Tool-use protocol, capabilities and environment details in one section. */
export function getCompactToolsSection(): string {
	return `====

TOOLS

- Your tools are exactly the ones in this request's tool list. The list depends on your mode. Never call a tool that is not in it.
- Call one tool per message. Then stop and wait for its result. Never guess a result.
- Pass only the parameters the tool defines. Leave out optional ones you do not need.
- Each user message ends with environment_details. The system writes it, not the user. It holds the current time, and in the first message a list of workspace files.`
}

/** Read before editing, copy old_string exactly, check the result. */
export function getCompactEditingSection(): string {
	return `====

EDITING FILES

1. Read a file with read_file before you change it. read_file shows the lines without line numbers. If it says the output was truncated, read on with the offset it gives.
2. Change a file with edit. Copy old_string exactly from the read_file output, with enough lines to match one place only. new_string replaces it.
3. Use write_to_file only for a new file or to rewrite a whole file.
4. Check every tool result. If an edit failed or you are unsure, read the changed lines again and fix them before you finish.`
}

/**
 * "Today" comes from environment_details, and a dated entry goes under its own
 * date. The example is the only one in the compact prompt. Its date is
 * deliberately in the past, so a small model that copies example values does
 * not mistake it for the real current date. The `\\n` sequences render as the
 * two characters backslash and n, which is how a newline is written inside a
 * JSON tool argument.
 */
export function getCompactDatesSection(): string {
	return `====

DATES

"Today" is the date in "Current time" in environment_details. When the user gives no date, the entry belongs to today. Put a dated entry under the heading of its date. If that heading does not exist yet, create it in the same format as the other dates. Never put today's entry under another date.

Example. Current time: 2025-03-14 12:05 (Friday), Europe/Warsaw. notes.md ends with:
## 2025-03-13
- Team meeting at 10:00
The user says "note that I sent the report today". There is no 2025-03-14 heading yet, so call edit with:
{"file_path": "notes.md", "old_string": "## 2025-03-13\\n- Team meeting at 10:00", "new_string": "## 2025-03-13\\n- Team meeting at 10:00\\n\\n## 2025-03-14\\n- Sent the report"}`
}

/** Objective, output efficiency, markdown and path rules in one section. */
export function getCompactRulesSection(): string {
	return `====

RULES

- Finish every task with attempt_completion. State what you did, or give the answer. This holds in every mode, also when you only answer a question.
- Ask the user with ask_followup_question only when you cannot do the task otherwise.
- Do only what the user asked. When it is done, call attempt_completion; do not offer or ask about extra work.
- Reply in the user's language.
- Be brief. Write at most one short sentence before a tool call. Do not repeat file contents or tool results.
- Format replies in Markdown. Name files by their path, for example \`docs/notes.md\`.
- Use paths relative to the workspace directory. Use an absolute path only for a file outside it. Never use ~ or $HOME.`
}
