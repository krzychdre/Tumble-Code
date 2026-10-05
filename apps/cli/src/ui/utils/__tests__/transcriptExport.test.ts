/**
 * /copy and /export (UI plan §4), the pure part: what "the last answer" and
 * "the last code block" are, the OSC 52 clipboard sequence, and the Markdown
 * a transcript exports to.
 */

import path from "path"

import type { TUIMessage } from "../../types.js"
import { defaultExportPath, lastAnswer, lastCodeBlock, osc52Copy, transcriptToMarkdown } from "../transcriptExport.js"

const user = (id: string, content: string): TUIMessage => ({ id, role: "user", content })
const answer = (id: string, content: string, partial = false): TUIMessage => ({
	id,
	role: "assistant",
	content,
	partial,
})
const completion = (id: string, result: string): TUIMessage => ({
	id,
	role: "tool",
	content: JSON.stringify({ result }),
	toolName: "attempt_completion",
	originalType: "completion_result",
	toolData: { tool: "attempt_completion", result, content: result },
})
const command = (id: string, cmd: string, output: string): TUIMessage => ({
	id,
	role: "tool",
	content: cmd,
	toolName: "execute_command",
	toolData: { tool: "execute_command", command: cmd, output },
})

describe("lastAnswer", () => {
	it("is the newest finished assistant text or completion result", () => {
		expect(lastAnswer([user("1", "hi"), answer("2", "first"), completion("3", "done")])).toBe("done")
		expect(lastAnswer([completion("3", "done"), answer("4", "later")])).toBe("later")
	})

	it("skips an answer still streaming", () => {
		expect(lastAnswer([answer("2", "first"), answer("3", "half", true)])).toBe("first")
	})

	it("is null without any answer", () => {
		expect(lastAnswer([user("1", "hi")])).toBeNull()
	})
})

describe("lastCodeBlock", () => {
	it("is the body of the last fenced block of the newest answer that has one", () => {
		const messages = [
			answer("1", "```ts\nconst a = 1\n```"),
			answer("2", "Run:\n```sh\nnpm test\n```\nthen\n```sh\nnpm run build\n```\n"),
			answer("3", "No code here."),
		]

		expect(lastCodeBlock(messages)).toBe("npm run build")
	})

	it("reads tildes and longer fences", () => {
		expect(lastCodeBlock([answer("1", "~~~\nx\n~~~")])).toBe("x")
		expect(lastCodeBlock([answer("1", "````md\n```js\ninner\n```\n````")])).toBe("```js\ninner\n```")
	})

	it("is null when no answer has a fenced block", () => {
		expect(lastCodeBlock([answer("1", "plain")])).toBeNull()
	})
})

describe("osc52Copy", () => {
	it("encodes the text as base64 in an OSC 52 clipboard write", () => {
		expect(osc52Copy("héllo", {})).toBe(`\x1b]52;c;${Buffer.from("héllo", "utf8").toString("base64")}\x07`)
	})

	it("wraps the sequence for tmux so it reaches the outer terminal", () => {
		const sequence = osc52Copy("x", { TMUX: "/tmp/tmux-1000/default,1,0" })

		expect(sequence.startsWith("\x1bPtmux;\x1b\x1b]52;c;")).toBe(true)
		expect(sequence.endsWith("\x1b\\")).toBe(true)
	})
})

describe("transcriptToMarkdown", () => {
	it("writes the turns as Markdown sections, commands as fenced blocks, and skips thinking", () => {
		const savedTz = process.env.TZ
		process.env.TZ = "Europe/Warsaw"
		onTestFinished(() => {
			if (savedTz === undefined) delete process.env.TZ
			else process.env.TZ = savedTz
		})
		const markdown = transcriptToMarkdown(
			[
				user("1", "List the files"),
				{ id: "2", role: "thinking", content: "hmm" },
				command("3", "ls", "a.txt\nb.txt"),
				answer("4", "Two files."),
				{ id: "5", role: "system", content: "Permissions: asking before actions." },
			],
			{ exportedAt: new Date("2026-09-28T12:34:56Z"), mode: "code", model: "gpt-5" },
		)

		expect(markdown).toContain("# Tumble Code transcript")
		expect(markdown).toContain("Exported 2026-09-28T14:34:56+02:00")
		expect(markdown).toContain("code")
		expect(markdown).toContain("gpt-5")
		expect(markdown).toContain("## You\n\nList the files")
		expect(markdown).not.toContain("hmm")
		expect(markdown).toContain("```sh\n$ ls\na.txt\nb.txt\n```")
		expect(markdown).toContain("## Tumble\n\nTwo files.")
		expect(markdown).toContain("> Permissions: asking before actions.")
		expect(markdown.endsWith("\n")).toBe(true)
	})

	it("uses a fence longer than any fence inside the output", () => {
		const markdown = transcriptToMarkdown([command("1", "cat README.md", "```js\nx\n```")], {
			exportedAt: new Date(0),
		})

		expect(markdown).toContain("````sh\n$ cat README.md\n```js\nx\n```\n````")
	})
})

describe("defaultExportPath", () => {
	it("names the file after the local time, in the workspace", () => {
		const now = new Date(2026, 8, 28, 7, 5, 9)

		expect(defaultExportPath(path.resolve("/work"), now)).toBe(
			path.join(path.resolve("/work"), "tumble-export-2026-09-28-070509.md"),
		)
	})
})
