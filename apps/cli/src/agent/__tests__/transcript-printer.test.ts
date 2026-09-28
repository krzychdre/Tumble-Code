import type { TUIMessage } from "../../ui/types.js"
import { OutputManager } from "../output-manager.js"
import { TranscriptPrinter } from "../transcript-printer.js"
import type { TranscriptEffect } from "../transcript-reducer.js"

function createPrinter() {
	const chunks: string[] = []
	const stream = (tag: string) =>
		({
			write: (chunk: string) => {
				chunks.push(tag ? `${tag}${chunk}` : chunk)
				return true
			},
		}) as unknown as NodeJS.WriteStream

	const printer = new TranscriptPrinter(
		new OutputManager({ stdout: stream(""), stderr: stream("«err»") }),
		() => true,
	)

	return { printer, output: () => chunks.join("") }
}

const row = (id: string, originalType: TUIMessage["originalType"], content: string, partial = false): TUIMessage => ({
	id,
	role: originalType === "reasoning" ? "thinking" : "assistant",
	content,
	partial,
	originalType,
})

const add = (message: TUIMessage): TranscriptEffect => ({ type: "addMessage", message })

describe("TranscriptPrinter", () => {
	it("never rewrites a row further up: an older, shorter text is ignored and new growth starts the row again below", () => {
		const { printer, output } = createPrinter()

		printer.apply([add(row("1", "text", "Dzień", true))])
		printer.apply([add(row("2", "reasoning", "Hmm", true))])
		// A state push replays the abandoned first delivery (shorter text).
		printer.apply([add(row("1", "text", "Dzi", true))])
		// The restarted stream, routed to row 1 by the reducer, grows.
		printer.apply([add(row("1", "text", "Dzień dobry", true))])
		printer.apply([add(row("1", "text", "Dzień dobry!", false))])

		expect(output()).toBe("\n[assistant] Dzień\n[reasoning] Hmm\n[assistant] Dzień dobry!\n")
	})

	it("writes an error row once, to stderr", () => {
		const { printer, output } = createPrinter()

		printer.apply([add(row("1", "error", "Boom"))])
		printer.apply([add(row("1", "error", "Boom"))])
		printer.apply([add(row("2", "error", ""))])

		expect(output()).toBe("«err»\n[error] Boom\n«err»\n[error] Unknown error\n")
	})

	it("prints nothing of a resumed task's history until the core asks to resume", () => {
		const { printer, output } = createPrinter()

		printer.beginHistoryReplay()
		printer.apply([add(row("1", "text", "Old answer.")), add(row("2", "reasoning", "Old thought."))])
		printer.apply([{ type: "setHasStartedTask", started: true }, add(row("3", "text", "New answer."))])

		expect(output()).toBe("\n[assistant] New answer.\n")
		// The history rows are still part of the view the reducer reads.
		expect(printer.view().messages.map((m) => m.id)).toEqual(["1", "2", "3"])
	})

	it("adds the completion ask's own text to [task complete] only when no completion text was printed", () => {
		const completionAsk = (id: string, content: string, toolContent?: string): TUIMessage => ({
			id,
			role: "tool",
			content,
			toolName: "attempt_completion",
			originalType: "completion_result",
			toolData: { tool: "attempt_completion", content: toolContent },
		})

		const plain = createPrinter()
		// A text that is not JSON: the reducer keeps it in toolData.content.
		plain.printer.apply([add(completionAsk("1", "Task completed", "All done"))])
		expect(plain.output()).toBe("\n[task complete] All done\n")

		const afterText = createPrinter()
		afterText.printer.apply([add(row("1", "completion_result", "Result."))])
		afterText.printer.apply([add(completionAsk("2", "Task completed", "All done"))])
		afterText.printer.apply([add(completionAsk("2", "Task completed", "All done"))])
		expect(afterText.output()).toBe("\n[assistant] Result.\n\n[task complete]\n")
	})

	it("reports itself as always inside a turn and never resuming", () => {
		const { printer } = createPrinter()

		expect(printer.view()).toMatchObject({ isLoading: true, isResumingTask: false })
		expect(printer.nonInteractive()).toBe(true)
	})
})
