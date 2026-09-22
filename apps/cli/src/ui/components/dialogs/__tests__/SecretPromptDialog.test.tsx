import { render } from "ink-testing-library"

import SecretPromptDialog from "../SecretPromptDialog.js"
import type { SecretPrompt } from "../../../stores/secretPromptStore.js"

/**
 * Yield to React so a written keypress is processed and the frame flushes.
 *
 * A fixed sleep is not enough here: these cases send several keystrokes in a
 * row, and under a loaded parallel test run a 10ms pause is sometimes shorter
 * than the render it is waiting for, which made the suite fail only when run
 * together with the other 60 files.
 */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10))
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs

	while (!condition() && Date.now() < deadline) {
		await flush()
	}
}

const passwordPrompt: SecretPrompt = {
	id: 1,
	title: "The command needs an answer: git clone https://github.com/x/y.git",
	prompt: "Password for 'https://krzych@github.com':",
	masked: true,
}

describe("SecretPromptDialog", () => {
	it("shows which command is asking and what it asked", () => {
		const { lastFrame } = render(
			<SecretPromptDialog prompt={passwordPrompt} onSubmit={() => {}} onCancel={() => {}} />,
		)
		const frame = lastFrame() ?? ""

		expect(frame).toContain("git clone https://github.com/x/y.git")
		expect(frame).toContain("Password for 'https://krzych@github.com':")
		expect(frame).toContain("esc to refuse")
	})

	it("never puts the typed secret on screen", async () => {
		const { stdin, lastFrame } = render(
			<SecretPromptDialog prompt={passwordPrompt} onSubmit={() => {}} onCancel={() => {}} />,
		)

		stdin.write("hunter2")
		await waitFor(() => (lastFrame() ?? "").includes("•".repeat(7)))

		const frame = lastFrame() ?? ""
		expect(frame).not.toContain("hunter2")
		expect(frame).toContain("•".repeat(7))
	})

	it("hands the typed answer over on enter", async () => {
		let submitted: string | undefined
		const { stdin, lastFrame } = render(
			<SecretPromptDialog
				prompt={passwordPrompt}
				onSubmit={(value) => (submitted = value)}
				onCancel={() => {}}
			/>,
		)

		stdin.write("hunter2")
		await waitFor(() => (lastFrame() ?? "").includes("•".repeat(7)))
		stdin.write("\r")
		await waitFor(() => submitted !== undefined)

		expect(submitted).toBe("hunter2")
	})

	it("refuses the prompt on esc, which is what lets the command fail", async () => {
		let cancelled = false
		const { stdin } = render(
			<SecretPromptDialog prompt={passwordPrompt} onSubmit={() => {}} onCancel={() => (cancelled = true)} />,
		)

		// Esc as the terminal sends it.
		stdin.write("\u001B")
		await waitFor(() => cancelled)

		expect(cancelled).toBe(true)
	})

	it("clears the line on ctrl+u, for a mistyped secret nobody can see", async () => {
		let submitted: string | undefined
		const { stdin, lastFrame } = render(
			<SecretPromptDialog
				prompt={passwordPrompt}
				onSubmit={(value) => (submitted = value)}
				onCancel={() => {}}
			/>,
		)

		stdin.write("wrong")
		await waitFor(() => (lastFrame() ?? "").includes("•".repeat(5)))
		// Ctrl+U as the terminal sends it.
		stdin.write("\u0015")
		await waitFor(() => !(lastFrame() ?? "").includes("•"))
		stdin.write("right")
		await waitFor(() => (lastFrame() ?? "").includes("•".repeat(5)))
		stdin.write("\r")
		await waitFor(() => submitted !== undefined)

		expect(submitted).toBe("right")
	})

	it("shows a question that is not a secret in the clear", async () => {
		const hostKeyPrompt: SecretPrompt = {
			id: 2,
			title: "The command needs an answer: ssh example.com",
			prompt: "Are you sure you want to continue connecting (yes/no)?",
			masked: false,
		}

		const { stdin, lastFrame } = render(
			<SecretPromptDialog prompt={hostKeyPrompt} onSubmit={() => {}} onCancel={() => {}} />,
		)

		stdin.write("yes")
		await waitFor(() => (lastFrame() ?? "").includes("yes"))

		// Typing an invisible "yes" would be needless cruelty.
		expect(lastFrame() ?? "").toContain("yes")
	})
})
