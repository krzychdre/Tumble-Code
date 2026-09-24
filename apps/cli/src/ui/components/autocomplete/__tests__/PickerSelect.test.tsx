import { useState } from "react"
import { Box, Text } from "ink"
import { render } from "ink-testing-library"

import { PickerSelect } from "../PickerSelect.js"
import type { AutocompleteItem } from "../types.js"

const results: AutocompleteItem[] = [{ key: "new" }, { key: "permissions" }, { key: "init" }]

/** Yield to React so a written keypress is processed and the frame flushes. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10))
}

/** Wait until `assertion` holds instead of sleeping a fixed time. */
function until(assertion: () => void): Promise<void> {
	return vi.waitFor(assertion, { timeout: 10_000, interval: 5 })
}

const DOWN = "\x1b[B"
const UP = "\x1b[A"

/**
 * A parent that owns the highlight in React state, the way every real parent
 * of PickerSelect does: the new index only comes back as a prop after the
 * parent has rendered.
 */
function StatefulHost({ onSelect, initialIndex = 0 }: { onSelect: (item: AutocompleteItem) => void; initialIndex?: number }) {
	const [selectedIndex, setSelectedIndex] = useState(initialIndex)
	return (
		<PickerSelect
			results={results}
			selectedIndex={selectedIndex}
			onSelect={onSelect}
			onEscape={() => {}}
			onIndexChange={setSelectedIndex}
			renderItem={(item) => <Text>{item.key}</Text>}
		/>
	)
}

function renderPicker(selectedIndex: number, onSelect: (item: AutocompleteItem) => void) {
	return render(
		<PickerSelect
			results={results}
			selectedIndex={selectedIndex}
			onSelect={onSelect}
			onEscape={() => {}}
			onIndexChange={() => {}}
			renderItem={(item) => <Text>{item.key}</Text>}
		/>,
	)
}

describe("PickerSelect", () => {
	it("accepts the highlighted item on Enter", async () => {
		const selected: string[] = []
		const { stdin } = renderPicker(1, (item) => selected.push(item.key))

		stdin.write("\r")
		await flush()

		expect(selected).toEqual(["permissions"])
	})

	// The picker is the only owner of Enter and Tab while it is open; the input
	// underneath stays active so that typing keeps filtering the list, but it
	// deliberately has no handler for these two keys.
	it("accepts the highlighted item on Tab", async () => {
		const selected: string[] = []
		const { stdin } = renderPicker(2, (item) => selected.push(item.key))

		stdin.write("\t")
		await flush()

		expect(selected).toEqual(["init"])
	})

	it("ignores Shift+Tab, which cycles modes instead", async () => {
		const selected: string[] = []
		const { stdin } = renderPicker(0, (item) => selected.push(item.key))

		// ESC [ Z is the backtab sequence; ink reports it as tab + shift
		stdin.write("\x1b[Z")
		await flush()

		expect(selected).toEqual([])
	})

	// PickerSelect is controlled: the parent owns the highlight. These tests pin
	// that contract so the rapid-key fix below cannot quietly change it.
	describe("parent contract", () => {
		function renderControlled(selectedIndex: number, onIndexChange: (index: number) => void, onSelect = () => {}) {
			const element = (index: number) => (
				<PickerSelect
					results={results}
					selectedIndex={index}
					onSelect={onSelect}
					onEscape={() => {}}
					onIndexChange={onIndexChange}
					renderItem={(item) => <Text>{item.key}</Text>}
				/>
			)
			const view = render(element(selectedIndex))
			return { ...view, rerenderAt: (index: number) => view.rerender(element(index)) }
		}

		it("reports the next index on down and wraps from the last item to the first", async () => {
			const onIndexChange = vi.fn()
			const { stdin, rerenderAt } = renderControlled(0, onIndexChange)

			stdin.write(DOWN)
			await until(() => expect(onIndexChange).toHaveBeenCalledTimes(1))
			expect(onIndexChange).toHaveBeenLastCalledWith(1)

			rerenderAt(2)
			stdin.write(DOWN)
			await until(() => expect(onIndexChange).toHaveBeenCalledTimes(2))
			expect(onIndexChange).toHaveBeenLastCalledWith(0)
		})

		it("reports the previous index on up and wraps from the first item to the last", async () => {
			const onIndexChange = vi.fn()
			const { stdin, rerenderAt } = renderControlled(0, onIndexChange)

			stdin.write(UP)
			await until(() => expect(onIndexChange).toHaveBeenCalledTimes(1))
			expect(onIndexChange).toHaveBeenLastCalledWith(2)

			rerenderAt(2)
			stdin.write(UP)
			await until(() => expect(onIndexChange).toHaveBeenCalledTimes(2))
			expect(onIndexChange).toHaveBeenLastCalledWith(1)
		})

		it("accepts the index the parent provides on the next render", async () => {
			const onSelect = vi.fn()
			const { stdin, rerenderAt } = renderControlled(0, () => {}, onSelect)

			rerenderAt(2)
			await flush()
			stdin.write("\r")

			await until(() => expect(onSelect).toHaveBeenCalled())
			expect(onSelect).toHaveBeenCalledTimes(1)
			expect(onSelect).toHaveBeenCalledWith(results[2])
		})

		it("lets a parent that keeps its index win once it renders", async () => {
			const onSelect = vi.fn()
			const onIndexChange = vi.fn()
			const { stdin, rerenderAt } = renderControlled(0, onIndexChange, onSelect)

			stdin.write(DOWN)
			await until(() => expect(onIndexChange).toHaveBeenCalledWith(1))
			// The parent declines the move and renders with its own index again.
			rerenderAt(0)
			await flush()
			stdin.write("\r")

			await until(() => expect(onSelect).toHaveBeenCalled())
			expect(onSelect).toHaveBeenCalledWith(results[0])
		})
	})

	// Keys a terminal delivers faster than React renders (a held arrow, a
	// paste, a fast typist) must move the highlight one row each: the handler
	// has to read the index the previous key produced, not the one the parent
	// last rendered.
	describe("keys that arrive before the parent renders", () => {
		it("selects the third item after down, down, Enter written back to back", async () => {
			const onSelect = vi.fn()
			const { stdin } = render(<StatefulHost onSelect={onSelect} />)

			stdin.write(DOWN)
			stdin.write(DOWN)
			stdin.write("\r")

			await until(() => expect(onSelect).toHaveBeenCalled())
			expect(onSelect).toHaveBeenCalledTimes(1)
			expect(onSelect).toHaveBeenCalledWith(results[2])
		})

		it("wraps around with up, up, Enter written back to back", async () => {
			const onSelect = vi.fn()
			const { stdin } = render(<StatefulHost onSelect={onSelect} />)

			stdin.write(UP) // wraps to the last item
			stdin.write(UP)
			stdin.write("\r")

			await until(() => expect(onSelect).toHaveBeenCalled())
			expect(onSelect).toHaveBeenCalledTimes(1)
			expect(onSelect).toHaveBeenCalledWith(results[1])
		})

		it("still follows the parent between keys when a render does happen", async () => {
			const onSelect = vi.fn()
			const { stdin, lastFrame } = render(<StatefulHost onSelect={onSelect} />)

			stdin.write(DOWN)
			await until(() => expect(lastFrame()).toContain("❯ permissions"))
			stdin.write(DOWN)
			await until(() => expect(lastFrame()).toContain("❯ init"))
			stdin.write("\r")

			await until(() => expect(onSelect).toHaveBeenCalled())
			expect(onSelect).toHaveBeenCalledWith(results[2])
		})
	})

	// The dropdown sits directly above the input box. Any row that does not fit
	// inside the picker's own box is drawn over the input, so the tests below
	// render a marker line underneath and check it is still intact.
	describe("layout", () => {
		const manyResults: AutocompleteItem[] = Array.from({ length: 12 }, (_, i) => ({ key: `item-${i}` }))

		function renderWithMarker(items: AutocompleteItem[], maxVisible: number, renderItem = defaultRenderItem) {
			return render(
				<Box flexDirection="column">
					<PickerSelect
						results={items}
						selectedIndex={0}
						maxVisible={maxVisible}
						onSelect={() => {}}
						onEscape={() => {}}
						onIndexChange={() => {}}
						renderItem={renderItem}
					/>
					<Text>INPUT-MARKER</Text>
				</Box>,
			)
		}

		function defaultRenderItem(item: AutocompleteItem) {
			return <Text>{item.key}</Text>
		}

		it("grows for the scroll indicator instead of overflowing onto the input", () => {
			const { lastFrame } = renderWithMarker(manyResults, 3)
			const lines = lastFrame()!.split("\n")

			expect(lines.filter((l) => l.includes("item-"))).toHaveLength(3)
			expect(lines.find((l) => l.includes("↓ 9 more"))).not.toContain("INPUT-MARKER")
			expect(lines[lines.length - 1]).toBe("INPUT-MARKER")
		})

		it("clips every item to one row even when renderItem would wrap", () => {
			const long = "d".repeat(300)
			const items: AutocompleteItem[] = [{ key: "first" }, { key: "second" }]
			const { lastFrame } = renderWithMarker(items, 2, (item) => (
				<Text>
					{item.key} {long}
				</Text>
			))
			const lines = lastFrame()!.split("\n")

			expect(lines).toHaveLength(3)
			expect(lines[0]).toContain("first")
			expect(lines[1]).toContain("second")
			expect(lines[2]).toBe("INPUT-MARKER")
		})
	})
})
