/**
 * Ctrl+R in the prompt (UI plan §4): a bash-style reverse search over the
 * input history. Typing narrows it, Ctrl+R again goes to an older match,
 * Enter puts the match into the prompt for editing (it does not send it),
 * Escape gives back what was typed before.
 */

import { useMemo, useRef } from "react"
import { render } from "ink-testing-library"

import { TerminalSizeProvider } from "../../../hooks/TerminalSizeContext.js"
import { AutocompleteInput, type AutocompleteInputHandle } from "../AutocompleteInput.js"
import { createSlashCommandTrigger, type SlashCommandResult } from "../triggers/SlashCommandTrigger.js"

vi.mock("../../../../lib/storage/history.js", () => ({
	loadHistory: vi.fn(async () => ["git status", "npm test", "git log --oneline"]),
	addToHistory: vi.fn(async (entry: string) => ["git status", "npm test", "git log --oneline", entry]),
}))

const CTRL_R = "\x12"
const ESC = "\x1b"

function plain(frame: string | undefined): string {
	// eslint-disable-next-line no-control-regex
	return (frame ?? "").replace(/\x1b\[[0-9;]*m/g, "")
}

const flush = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))
const until = (assertion: () => void) => vi.waitFor(assertion, { timeout: 10_000, interval: 5 })

async function type(stdin: { write: (data: string) => void }, text: string) {
	for (const char of text) {
		stdin.write(char)
		await flush()
	}
}

function Harness({
	onSubmit,
	handle,
}: {
	onSubmit: (value: string) => void
	handle?: (ref: AutocompleteInputHandle<SlashCommandResult> | null) => void
}) {
	const ref = useRef<AutocompleteInputHandle<SlashCommandResult>>(null)
	const triggers = useMemo(() => [createSlashCommandTrigger({ getCommands: () => [] })], [])
	handle?.(ref.current)

	return (
		<TerminalSizeProvider>
			<AutocompleteInput
				ref={(instance) => {
					ref.current = instance
					handle?.(instance)
				}}
				triggers={triggers}
				onSubmit={onSubmit}
			/>
		</TerminalSizeProvider>
	)
}

function renderHarness() {
	const submitted: string[] = []
	const view = render(<Harness onSubmit={(value) => submitted.push(value)} />)
	return { ...view, submitted }
}

describe("AutocompleteInput reverse search (Ctrl+R)", () => {
	it("shows the newest match for what is typed and moves to older ones on Ctrl+R", async () => {
		const { stdin, lastFrame } = renderHarness()
		await flush(50) // history loads asynchronously

		stdin.write(CTRL_R)
		await until(() => expect(plain(lastFrame())).toContain("reverse-i-search"))

		await type(stdin, "git")
		await until(() => expect(plain(lastFrame())).toContain("git log --oneline"))

		stdin.write(CTRL_R)
		await until(() => expect(plain(lastFrame())).toContain("git status"))
	})

	it("puts the match into the prompt on Enter without sending it", async () => {
		const { stdin, lastFrame, submitted } = renderHarness()
		await flush(50)

		stdin.write(CTRL_R)
		await type(stdin, "npm")
		await until(() => expect(plain(lastFrame())).toContain("npm test"))

		stdin.write("\r")
		await until(() => expect(plain(lastFrame())).not.toContain("reverse-i-search"))
		expect(plain(lastFrame())).toContain("npm test")
		expect(submitted).toEqual([])

		stdin.write("\r")
		await until(() => expect(submitted).toEqual(["npm test"]))
	})

	it("gives back the typed text on Escape", async () => {
		const { stdin, lastFrame } = renderHarness()
		await flush(50)

		await type(stdin, "draft")
		stdin.write(CTRL_R)
		await type(stdin, "git")
		await until(() => expect(plain(lastFrame())).toContain("git log --oneline"))

		stdin.write(ESC)
		await until(() => expect(plain(lastFrame())).not.toContain("reverse-i-search"))
		expect(plain(lastFrame())).toContain("draft")
		expect(plain(lastFrame())).not.toContain("git log")
	})

	it("says the search is failing when nothing matches", async () => {
		const { stdin, lastFrame } = renderHarness()
		await flush(50)

		stdin.write(CTRL_R)
		await type(stdin, "zzz")

		await until(() => expect(plain(lastFrame())).toContain("failing reverse-i-search"))
	})
})

describe("AutocompleteInput setValue (the /resume and --resume entry point)", () => {
	it("puts text into the prompt and runs trigger detection on it", async () => {
		let handle: AutocompleteInputHandle<SlashCommandResult> | null = null
		const { lastFrame } = render(<Harness onSubmit={() => {}} handle={(h) => (handle = h)} />)
		await flush(20)
		;(handle as AutocompleteInputHandle<SlashCommandResult> | null)?.setValue("hello")

		await until(() => expect(plain(lastFrame())).toContain("hello"))
	})
})
