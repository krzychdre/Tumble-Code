import { render } from "ink-testing-library"

import { MultilineTextInput } from "../MultilineTextInput.js"

/** Yield to React so a written keypress is processed and the frame flushes. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10))
}

function renderInput(lineNavigationActive: boolean | undefined) {
	const calls: string[] = []
	const view = render(
		<MultilineTextInput
			value="hello"
			onChange={() => {}}
			onUpAtFirstLine={() => calls.push("up")}
			onDownAtLastLine={() => calls.push("down")}
			lineNavigationActive={lineNavigationActive}
			columns={80}
		/>,
	)
	return { ...view, calls }
}

describe("MultilineTextInput", () => {
	it("hands Up/Down to the line callbacks by default", async () => {
		const { stdin, calls } = renderInput(undefined)

		stdin.write("\x1b[A")
		await flush()
		stdin.write("\x1b[B")
		await flush()

		expect(calls).toEqual(["up", "down"])
	})

	// While an autocomplete picker is open the arrows move its highlight; the
	// input must not also browse history or move the cursor between lines.
	it("ignores Up/Down when lineNavigationActive is false", async () => {
		const { stdin, calls, lastFrame } = renderInput(false)

		stdin.write("\x1b[A")
		await flush()
		stdin.write("\x1b[B")
		await flush()

		expect(calls).toEqual([])
		expect(lastFrame()).toContain("hello")
	})
})

// Ink 7 reports the Backspace byte (0x7F) as key.backspace; ink 6 reported it
// as key.delete. The input treats both the same way, so every one of these
// keys removes the character before the cursor on both versions.
describe("MultilineTextInput deleting keys", () => {
	function renderEditable(initial: string) {
		let value = initial
		const view = render(
			<MultilineTextInput
				value={initial}
				onChange={(next) => {
					value = next
				}}
				columns={80}
			/>,
		)
		return { ...view, value: () => value }
	}

	it.each([
		["Backspace (0x7F)", "\x7f"],
		["ctrl+h (0x08)", "\x08"],
		["Delete (CSI 3 ~)", "\x1b[3~"],
	])("%s removes the character before the cursor", async (_name, sequence) => {
		const { stdin, value } = renderEditable("")

		stdin.write("abc")
		await vi.waitFor(() => expect(value()).toBe("abc"), { timeout: 10_000, interval: 5 })
		stdin.write(sequence)

		await vi.waitFor(() => expect(value()).toBe("ab"), { timeout: 10_000, interval: 5 })
	})

	it("removes one character per Backspace press when a held key sends them in one chunk", async () => {
		const { stdin, value } = renderEditable("")

		stdin.write("abcd")
		await vi.waitFor(() => expect(value()).toBe("abcd"), { timeout: 10_000, interval: 5 })
		stdin.write("\x7f\x7f")
		await flush()
		await flush()

		expect(value()).toMatchSnapshot()
	})
})
