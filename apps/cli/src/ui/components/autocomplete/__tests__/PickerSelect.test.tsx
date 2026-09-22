import { Box, Text } from "ink"
import { render } from "ink-testing-library"

import { PickerSelect } from "../PickerSelect.js"
import type { AutocompleteItem } from "../types.js"

const results: AutocompleteItem[] = [{ key: "new" }, { key: "permissions" }, { key: "init" }]

/** Yield to React so a written keypress is processed and the frame flushes. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10))
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
