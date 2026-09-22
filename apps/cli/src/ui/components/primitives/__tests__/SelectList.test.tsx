import { render } from "ink-testing-library"

import SelectList, { type SelectItem } from "../SelectList.js"

const items: SelectItem[] = [
	{ label: "First option", value: "first" },
	{ label: "Second option", value: "second" },
	{ label: "Third option", value: "third" },
]

/** Yield to React so a written keypress is processed and the frame flushes. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10))
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
		await flush()
		const output = lastFrame()
		expect(output).toContain("1. First option")
		expect(output).toContain("❯ 2. Second option")
		expect(output).toContain("3. Third option")
	})

	it("calls onSelect with the focused value on Enter", async () => {
		const onSelect = (value: string) => {
			expect(value).toBe("third")
		}
		const { stdin } = render(<SelectList items={items} onSelect={onSelect} />)

		stdin.write("[B") // down
		await flush()
		stdin.write("[B") // down → third
		await flush()
		stdin.write("\r") // enter
		await flush()
	})

	it("calls onCancel on Escape when provided", async () => {
		let cancelled = false
		const { stdin } = render(<SelectList items={items} onSelect={() => {}} onCancel={() => (cancelled = true)} />)

		stdin.write("") // escape
		await flush()
		expect(cancelled).toBe(true)
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
