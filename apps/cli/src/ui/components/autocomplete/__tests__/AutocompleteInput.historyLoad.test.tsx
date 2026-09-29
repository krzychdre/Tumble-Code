/**
 * The input history is read from disk after the prompt mounts. Typing that
 * starts before the read finishes must not be reordered: the text input used
 * to be keyed on the history length, so the late load re-mounted it in the
 * middle of the typing and the cursor lost its place ("draft" came out as
 * "daftr" here and "raftd" on a Windows runner).
 */

import { useMemo } from "react"
import { render } from "ink-testing-library"

import { TerminalSizeProvider } from "../../../hooks/TerminalSizeContext.js"
import { AutocompleteInput } from "../AutocompleteInput.js"
import { createSlashCommandTrigger } from "../triggers/SlashCommandTrigger.js"

const historyLoad = vi.hoisted(() => ({ resolve: (_entries: string[]) => {} }))

vi.mock("../../../../lib/storage/history.js", () => ({
	loadHistory: vi.fn(() => new Promise<string[]>((resolve) => (historyLoad.resolve = resolve))),
	addToHistory: vi.fn(async (entry: string) => [entry]),
}))

function plain(frame: string | undefined): string {
	// eslint-disable-next-line no-control-regex
	return (frame ?? "").replace(/\x1b\[[0-9;]*m/g, "")
}

const flush = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))
const until = (assertion: () => void) => vi.waitFor(assertion, { timeout: 10_000, interval: 5 })

function Harness() {
	const triggers = useMemo(() => [createSlashCommandTrigger({ getCommands: () => [] })], [])

	return (
		<TerminalSizeProvider>
			<AutocompleteInput triggers={triggers} onSubmit={() => {}} />
		</TerminalSizeProvider>
	)
}

describe("AutocompleteInput while the history is still loading", () => {
	it("keeps the typed characters in order when the history arrives mid-typing", async () => {
		const { stdin, lastFrame } = render(<Harness />)
		await flush(50)

		stdin.write("d")
		await flush()
		historyLoad.resolve(["git status", "npm test"])
		await flush()
		for (const char of "raft") {
			stdin.write(char)
			await flush()
		}

		await until(() => expect(plain(lastFrame())).toContain("draft"))
	})
})
