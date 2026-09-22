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
