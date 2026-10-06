import type { TUIMessage } from "../../types.js"
import { estimateStepOutputTokens } from "../liveTokens.js"

const row = (id: string, role: TUIMessage["role"], content: string, extra: Partial<TUIMessage> = {}): TUIMessage => ({
	id,
	role,
	content,
	...extra,
})

describe("estimateStepOutputTokens", () => {
	it("counts what the model wrote in the step, about four characters per token", () => {
		const messages = [
			row("1000", "assistant", "x".repeat(400)), // an earlier step
			row("2000", "thinking", "y".repeat(800)),
			row("2001", "assistant", "z".repeat(400), { partial: true }),
		]

		expect(estimateStepOutputTokens(messages, 2_000)).toBe(300)
	})

	it("counts the file a tool call writes, not only the row's summary", () => {
		const messages = [
			row("2000", "tool", "Write src/a.ts", { toolData: { tool: "write_to_file", content: "c".repeat(386) } }),
		]

		expect(estimateStepOutputTokens(messages, 2_000)).toBe(100)
	})

	it("skips rows the model did not write and rows the CLI added", () => {
		const messages = [
			row("2000", "assistant", "a".repeat(40)),
			row("2001", "tool", "o".repeat(4000), { originalType: "command_output" }),
			row("6f1c0b9e-uuid", "user", "u".repeat(4000)),
			row("6f1c0b9e-uuid-2", "system", "s".repeat(4000)),
		]

		expect(estimateStepOutputTokens(messages, 2_000)).toBe(10)
	})
})
