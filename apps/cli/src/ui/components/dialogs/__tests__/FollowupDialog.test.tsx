import { render } from "ink-testing-library"

import FollowupDialog from "../FollowupDialog.js"
import type { PendingAsk } from "../../../types.js"

/** Yield to React so a written keypress is processed and the frame flushes. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10))
}

describe("FollowupDialog", () => {
	// CLI-5: the dialog showed "-> code mode" next to a suggestion but handed
	// over only the answer text, so picking it never switched the mode (the
	// webview does). Two suggestions with the same answer and different modes
	// were also indistinguishable.
	it("hands over the picked suggestion with its mode", async () => {
		const ask: PendingAsk = {
			id: "f-1",
			type: "followup",
			content: "Next?",
			suggestions: [{ answer: "Go", mode: "architect" }, { answer: "Go", mode: "code" }],
		}
		const onSelect = vi.fn()
		const { stdin } = render(
			<FollowupDialog ask={ask} onSelect={onSelect} onCustomInput={() => {}} countdownSeconds={null} />,
		)

		stdin.write("\u001B[B")
		await flush()
		stdin.write("\r")
		await flush()

		expect(onSelect).toHaveBeenCalledWith({ answer: "Go", mode: "code" })
	})

	it("shows the question as given", () => {
		const ask: PendingAsk = { id: "f-2", type: "followup", content: "Which one?", suggestions: [{ answer: "A" }] }
		const { lastFrame } = render(
			<FollowupDialog ask={ask} onSelect={() => {}} onCustomInput={() => {}} countdownSeconds={null} />,
		)

		expect(lastFrame()).toContain("Which one?")
	})
})
