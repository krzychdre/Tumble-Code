import { Text } from "ink"
import { render } from "ink-testing-library"

import { useCLIStore } from "../../store.js"
import { useUIStateStore } from "../../stores/uiStateStore.js"
import { useGlobalInput } from "../useGlobalInput.js"

/** Yield to React so a written keypress is processed and the frame flushes. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10))
}

/** Ctrl+O as a terminal sends it: 'o' masked with 0x1f. */
const CTRL_O = "\x0f"

describe("useGlobalInput ctrl+o", () => {
	function Harness({ pickerIsOpen = false }: { pickerIsOpen?: boolean }) {
		useGlobalInput({
			pickerIsOpen,
			availableModes: [],
			currentMode: null,
			mode: "code",
			sendToExtension: vi.fn(),
			showInfo: vi.fn(),
			exit: vi.fn(),
			cleanup: vi.fn(async () => undefined),
			closePicker: vi.fn(),
		})
		return <Text>harness</Text>
	}

	beforeEach(() => {
		useCLIStore.getState().reset()
		useUIStateStore.getState().resetUIState()
	})

	it("expands on the first press and collapses on the second", async () => {
		const { stdin } = render(<Harness />)

		stdin.write(CTRL_O)
		await flush()
		expect(useUIStateStore.getState().verboseTranscript).toBe(true)

		stdin.write(CTRL_O)
		await flush()
		expect(useUIStateStore.getState().verboseTranscript).toBe(false)
	})

	it("reprints the transcript in BOTH directions", async () => {
		// A terminal cannot un-print a line, so collapsing is also a reprint: the
		// epoch is what remounts `<Static>` and makes ink print the transcript
		// again, this time collapsed.
		const { stdin } = render(<Harness />)

		stdin.write(CTRL_O)
		await flush()
		expect(useUIStateStore.getState().transcriptReprintEpoch).toBe(1)

		stdin.write(CTRL_O)
		await flush()
		expect(useUIStateStore.getState().transcriptReprintEpoch).toBe(2)
	})

	it("wipes the screen and its scrollback before each reprint", async () => {
		const { stdin, frames } = render(<Harness />)

		stdin.write(CTRL_O)
		await flush()

		const written = frames.join("")
		expect(written).toContain("\x1b[2J")
		expect(written).toContain(process.platform === "win32" ? "\x1b[0f" : "\x1b[3J")
	})

	it("wipes before toggling, so the reprint lands on the cleared screen", async () => {
		const order: string[] = []
		const view = render(<Harness />)
		const frames = view.frames
		frames.push = ((...args: string[]) => {
			order.push("write")
			return Array.prototype.push.apply(frames, args)
		}) as typeof frames.push
		const unsubscribe = useUIStateStore.subscribe(() => order.push("toggle"))

		view.stdin.write(CTRL_O)
		await flush()
		unsubscribe()

		expect(order.indexOf("write")).toBeLessThan(order.indexOf("toggle"))
	})
})
