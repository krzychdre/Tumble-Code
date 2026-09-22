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

	it("tells the user the clamped body prints in full on completion", () => {
		// There is deliberately no expand affordance in the tail (I1), so the
		// marker has to say where the hidden text will show up instead.
		const message: TUIMessage = {
			id: "4",
			role: "assistant",
			content: Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"),
		}

		const { lastFrame } = render(<DynamicTailMessage message={message} maxRows={5} columns={120} />)

		expect(lastFrame()).toContain("(prints in full when this message completes)")
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
