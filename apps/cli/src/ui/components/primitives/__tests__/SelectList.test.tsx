import { render } from "ink-testing-library"

import SelectList, { type SelectItem } from "../SelectList.js"

const items: SelectItem[] = [
	{ label: "First option", value: "first" },
	{ label: "Second option", value: "second" },
	{ label: "Third option", value: "third" },
]

/** Hand the event loop over between keystrokes, the way a terminal delivers them. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10))
}

/**
 * Wait until `assertion` holds. Moving the focus re-renders in a task React
 * schedules, not synchronously, so a fixed sleep before reading the frame
 * races that render on a loaded machine.
 */
function until(assertion: () => void): Promise<void> {
	return vi.waitFor(assertion, { timeout: 10_000, interval: 5 })
}

describe("SelectList", () => {
	it("renders items with the first focused (pointer) and number prefixes", () => {
		const { lastFrame } = render(<SelectList items={items} onSelect={() => {}} />)
		const output = lastFrame()
		expect(output).toContain("❯ 1. First option")
		expect(output).toContain("2. Second option")
		expect(output).toContain("3. Third option")
	})

	it("moves focus down with the down arrow", async () => {
		const { lastFrame, stdin } = render(<SelectList items={items} onSelect={() => {}} />)

		stdin.write("[B") // down arrow
		await until(() => expect(lastFrame()).toContain("❯ 2. Second option"))
		const output = lastFrame()
		expect(output).toContain("1. First option")
		expect(output).toContain("❯ 2. Second option")
		expect(output).toContain("3. Third option")
	})

	it("calls onSelect with the focused value on Enter", async () => {
		const onSelect = vi.fn()
		const { stdin, lastFrame } = render(<SelectList items={items} onSelect={onSelect} />)

		stdin.write("\u001B[B") // down
		await until(() => expect(lastFrame()).toContain("❯ 2. Second option"))
		stdin.write("\u001B[B") // down -> third
		await until(() => expect(lastFrame()).toContain("❯ 3. Third option"))
		stdin.write("\r") // enter

		await until(() => expect(onSelect).toHaveBeenCalled())
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(onSelect).toHaveBeenCalledWith("third")
	})

	// Keys a terminal delivers faster than React renders (a held arrow, a
	// paste, a fast typist) must still move the focus one row each: the
	// handler has to read the index the previous key produced, not the one
	// last rendered.
	it("selects the right item when down, down, Enter arrive without a render in between", async () => {
		const onSelect = vi.fn()
		const { stdin } = render(<SelectList items={items} onSelect={onSelect} />)

		stdin.write("\u001B[B") // down -> second
		stdin.write("\u001B[B") // down -> third
		stdin.write("\r") // enter

		await until(() => expect(onSelect).toHaveBeenCalled())
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(onSelect).toHaveBeenCalledWith("third")
	})

	it("selects the right item when up, up, Enter arrive without a render in between", async () => {
		const onSelect = vi.fn()
		const { stdin } = render(<SelectList items={items} onSelect={onSelect} />)

		stdin.write("\u001B[A") // up -> wraps to third
		stdin.write("\u001B[A") // up -> second
		stdin.write("\r") // enter

		await until(() => expect(onSelect).toHaveBeenCalled())
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(onSelect).toHaveBeenCalledWith("second")
	})

	it("calls onCancel on Escape when provided", async () => {
		let cancelled = false
		const { stdin } = render(<SelectList items={items} onSelect={() => {}} onCancel={() => (cancelled = true)} />)

		// Ink 7 holds a lone ESC byte for 20 ms (it may start an escape
		// sequence) before it reports Escape, so wait for it instead of sleeping.
		stdin.write("\x1b") // escape
		await until(() => expect(cancelled).toBe(true))
	})

	it("jump-selects a single digit within range", async () => {
		let selected: string | undefined
		const { stdin } = render(<SelectList items={items} onSelect={(value) => (selected = value)} />)

		stdin.write("2")
		await flush()
		expect(selected).toBe("second")
	})

	it("does not crash with empty items", () => {
		const { lastFrame } = render(<SelectList items={[]} onSelect={() => {}} />)
		expect(lastFrame()).toBe("")
	})
})
