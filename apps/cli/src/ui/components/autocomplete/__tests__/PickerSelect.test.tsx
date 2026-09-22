import { Text } from "ink"
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

	// Tab has to be handled here rather than in AutocompleteInput: the whole
	// input area is rendered with isActive={false} while the picker is open, so
	// no handler inside it ever sees a key press.
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
})
