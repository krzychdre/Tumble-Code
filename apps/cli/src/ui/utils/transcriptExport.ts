/**
 * /copy and /export (UI plan §4): the last answer, its last code block, the
 * OSC 52 clipboard write, and the Markdown a transcript exports to. Pure;
 * useTaskSubmit does the writing.
 */

import path from "path"

import { formatLocalIso } from "../../lib/utils/time-zone.js"
import type { TUIMessage } from "../types.js"

/**
 * The text of an answer row: an assistant text (say text or say
 * completion_result) or the attempt_completion row's result. Null for
 * anything else and for a row still streaming.
 */
function answerText(message: TUIMessage): string | null {
	if (message.partial) {
		return null
	}

	if (message.role === "assistant") {
		return message.content.trim() ? message.content : null
	}

	if (message.toolName === "attempt_completion") {
		const result = message.toolData?.result
		return result && result.trim() ? result : null
	}

	return null
}

/** The newest finished answer. */
export function lastAnswer(messages: readonly TUIMessage[]): string | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		const text = answerText(messages[index]!)

		if (text !== null) {
			return text
		}
	}

	return null
}

/**
 * Fenced blocks of a Markdown text, in order: an opening fence of three or
 * more backticks or tildes (an info string may follow) closed by a fence of
 * the same character at least as long.
 */
function fencedBlocks(text: string): string[] {
	const blocks: string[] = []
	const lines = text.split("\n")
	let open: { char: string; length: number; body: string[] } | null = null

	for (const line of lines) {
		const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)

		if (!open) {
			if (fence) {
				open = { char: fence[1]![0]!, length: fence[1]!.length, body: [] }
			}
			continue
		}

		const closes = fence && fence[1]![0] === open.char && fence[1]!.length >= open.length && fence[2]!.trim() === ""

		if (closes) {
			blocks.push(open.body.join("\n"))
			open = null
		} else {
			open.body.push(line)
		}
	}

	return blocks
}

/** The last fenced code block of the newest answer that has one. */
export function lastCodeBlock(messages: readonly TUIMessage[]): string | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		const text = answerText(messages[index]!)
		const blocks = text ? fencedBlocks(text) : []

		if (blocks.length > 0) {
			return blocks[blocks.length - 1]!
		}
	}

	return null
}

/**
 * The OSC 52 escape that asks the terminal to put `text` on the clipboard.
 * Under tmux the sequence is wrapped in tmux's passthrough (DCS tmux; ... ST,
 * every ESC doubled), so it reaches the outer terminal; tmux still needs
 * `allow-passthrough on` (or `set-clipboard on`) for it.
 */
export function osc52Copy(text: string, env: NodeJS.ProcessEnv = process.env): string {
	const sequence = `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`

	return env.TMUX ? `\x1bPtmux;${sequence.split("\x1b").join("\x1b\x1b")}\x1b\\` : sequence
}

/** A fence one longer than the longest backtick run inside `text`, at least three. */
function fenceFor(text: string): string {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
	return "`".repeat(Math.max(3, longest + 1))
}

function fenced(info: string, body: string): string {
	const fence = fenceFor(body)
	return `${fence}${info}\n${body.replace(/\n+$/, "")}\n${fence}`
}

function toolSection(message: TUIMessage): string | null {
	const data = message.toolData

	if (message.toolName === "attempt_completion") {
		const result = answerText(message)
		return result ? `## Tumble\n\n${result}` : null
	}

	if (data?.command !== undefined || message.toolName === "execute_command") {
		const command = data?.command ?? message.content
		const output = data?.output ? `\n${data.output}` : ""
		return fenced("sh", `$ ${command}${output}`)
	}

	const name = data?.tool ?? message.toolName ?? "tool"
	const subject = data?.subject ?? data?.path
	return `*Tool: ${name}${subject ? ` ${subject}` : ""}*`
}

export interface TranscriptExportMeta {
	exportedAt: Date
	mode?: string
	model?: string
}

/**
 * The transcript as Markdown: a heading with the export time, mode and model,
 * then one section per row. Your prompts are "## You", answers "## Tumble",
 * shell commands a `sh` block with their output, other tools one italic line,
 * system notes a quote. Thinking is left out.
 */
export function transcriptToMarkdown(messages: readonly TUIMessage[], meta: TranscriptExportMeta): string {
	const facts = [`Exported ${formatLocalIso(meta.exportedAt)}`]

	if (meta.mode) {
		facts.push(`mode ${meta.mode}`)
	}

	if (meta.model) {
		facts.push(`model ${meta.model}`)
	}

	const sections = [`# Tumble Code transcript\n\n${facts.join(", ")}`]

	for (const message of messages) {
		let section: string | null = null

		switch (message.role) {
			case "user":
				section = `## You\n\n${message.content}`
				break
			case "assistant":
				section = answerText(message) === null ? null : `## Tumble\n\n${message.content}`
				break
			case "tool":
				section = toolSection(message)
				break
			case "system":
				section = message.content
					.split("\n")
					.map((line) => `> ${line}`)
					.join("\n")
				break
			case "thinking":
				break
		}

		if (section) {
			sections.push(section)
		}
	}

	return `${sections.join("\n\n")}\n`
}

/** `<workspace>/tumble-export-YYYY-MM-DD-HHMMSS.md`, local time. */
export function defaultExportPath(workspace: string, now: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0")
	const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
	return path.join(workspace, `tumble-export-${date}-${time}.md`)
}
