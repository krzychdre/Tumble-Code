import { render } from "ink-testing-library"

import type { TUIMessage } from "../../types.js"
import ChatHistoryItem from "../ChatHistoryItem.js"
import DynamicTailMessage from "../DynamicTailMessage.js"

describe("DynamicTailMessage", () => {
	it("renders short messages without a clamp indicator", () => {
		const message: TUIMessage = {
			id: "1",
			role: "assistant",
			content: "short answer",
		}

		const { lastFrame } = render(<DynamicTailMessage message={message} maxRows={10} columns={80} />)
		const output = lastFrame()

		expect(output).toContain("short answer")
		expect(output).not.toContain("+")
	})

	it("clamps long assistant messages and shows the hidden-line count", () => {
		const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`)
		const message: TUIMessage = {
			id: "2",
			role: "assistant",
			content: lines.join("\n"),
		}

		const { lastFrame } = render(<DynamicTailMessage message={message} maxRows={5} columns={80} />)
		const output = lastFrame()

		expect(output).toContain("+25 lines")
		expect(output).toContain("line 29")
		expect(output).not.toContain("line 24\n")
	})

	it("does not clamp tool messages (renderers cap their own previews)", () => {
		const message: TUIMessage = {
			id: "3",
			role: "tool",
			toolName: "someTool",
			content: Array.from({ length: 30 }, (_, i) => `out ${i}`).join("\n"),
		}

		const { lastFrame } = render(<DynamicTailMessage message={message} maxRows={5} columns={80} />)
		const plain = render(<ChatHistoryItem message={message} />)

		// Identical to the unwrapped render — the tool renderer's own preview
		// cap applies, but DynamicTailMessage adds no clamp of its own.
		expect(lastFrame()).toBe(plain.lastFrame())
	})
})
