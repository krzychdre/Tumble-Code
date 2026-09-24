import { useEffect, useMemo, useRef, useState } from "react"
import { Box } from "ink"
import { render } from "ink-testing-library"

import { TerminalSizeProvider } from "../../../hooks/TerminalSizeContext.js"
import { AutocompleteInput, type AutocompleteInputHandle } from "../AutocompleteInput.js"
import { PickerSelect } from "../PickerSelect.js"
import { createSlashCommandTrigger, type SlashCommandResult } from "../triggers/SlashCommandTrigger.js"
import type { AutocompletePickerState } from "../types.js"

// History is loaded from and written to ~/.roo; the tests must not touch it.
vi.mock("../../../../lib/storage/history.js", () => ({
	loadHistory: vi.fn(async () => []),
	addToHistory: vi.fn(async (entry: string) => [entry]),
}))

const commands: SlashCommandResult[] = [
	{ key: "new", name: "new", description: "Start a new task", source: "global", action: "clearTask" },
	{
		key: "permissions",
		name: "permissions",
		description: "Change action approval mode",
		argumentHint: "<ask|allow>",
		source: "global",
		action: "setPermissions",
	},
	{ key: "init", name: "init", description: "Initialize project", source: "built-in" },
]

/** The frame paints the cursor as an inverted cell; compare plain text. */
function plain(frame: string | undefined): string {
	// eslint-disable-next-line no-control-regex
	return (frame ?? "").replace(/\x1b\[[0-9;]*m/g, "")
}

/** Hand the event loop over between keystrokes, the way a terminal delivers them. */
function flush(ms = 10): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wait until `assertion` holds. A keypress that changes state does not render
 * synchronously: React schedules the render, and the passive effects that
 * report the picker state, as separate tasks. A fixed sleep races those tasks
 * and lost on a loaded machine (CI); waiting for the observable outcome does
 * not, and returns as soon as it holds.
 */
function until(assertion: () => void): Promise<void> {
	return vi.waitFor(assertion, { timeout: 10_000, interval: 5 })
}

/** Type one key at a time, the way a terminal delivers keystrokes. */
async function type(stdin: { write: (data: string) => void }, text: string): Promise<void> {
	for (const char of text) {
		stdin.write(char)
		await flush()
	}
}

/**
 * Mirrors the wiring in App.tsx: the input owns the picker state and the
 * PickerSelect is rendered next to it, driving the input through its ref.
 */
function Harness({
	onSubmit,
	onPickerState,
	onPickerRendered,
}: {
	onSubmit: (value: string) => void
	onPickerState: (state: AutocompletePickerState<SlashCommandResult>) => void
	onPickerRendered: (state: AutocompletePickerState<SlashCommandResult> | null) => void
}) {
	const ref = useRef<AutocompleteInputHandle<SlashCommandResult>>(null)
	const [pickerState, setPickerState] = useState<AutocompletePickerState<SlashCommandResult> | null>(null)
	const triggers = useMemo(() => [createSlashCommandTrigger({ getCommands: () => commands })], [])

	// Reported after the commit that rendered the PickerSelect with this state.
	// Child effects run before the parent's, so by now the picker's key
	// handler is subscribed and holds these results and this highlight: only
	// then does a key sent to the picker (Enter, arrows, Escape) reach it.
	useEffect(() => {
		onPickerRendered(pickerState)
	}, [pickerState, onPickerRendered])

	return (
		<TerminalSizeProvider>
			<Box flexDirection="column">
				{pickerState?.isOpen && pickerState.activeTrigger && (
					<PickerSelect
						results={pickerState.results}
						selectedIndex={pickerState.selectedIndex}
						onSelect={(item) => ref.current?.handleItemSelect(item)}
						onEscape={() => ref.current?.closePicker()}
						onIndexChange={(index) => ref.current?.handleIndexChange(index)}
						renderItem={pickerState.activeTrigger.renderItem}
						isActive={pickerState.isOpen}
					/>
				)}
				<AutocompleteInput
					ref={ref}
					triggers={triggers}
					onSubmit={onSubmit}
					onPickerStateChange={(state) => {
						setPickerState(state)
						onPickerState(state)
					}}
				/>
			</Box>
		</TerminalSizeProvider>
	)
}

function renderHarness() {
	const submitted: string[] = []
	const states: AutocompletePickerState<SlashCommandResult>[] = []
	const rendered: (AutocompletePickerState<SlashCommandResult> | null)[] = []
	const onPickerRendered = (state: AutocompletePickerState<SlashCommandResult> | null) => rendered.push(state)
	const view = render(
		<Harness
			onSubmit={(v) => submitted.push(v)}
			onPickerState={(s) => states.push(s)}
			onPickerRendered={onPickerRendered}
		/>,
	)
	const lastState = () => {
		const state = states[states.length - 1]
		if (!state) throw new Error("picker state was never reported")
		return state
	}
	/** Wait until the rendered picker is open and lists exactly `names`. */
	const pickerShows = (names: string[]) =>
		until(() => {
			const state = rendered[rendered.length - 1]
			expect(state?.isOpen).toBe(true)
			expect(state?.results.map((r) => r.name)).toEqual(names)
		})
	/** Wait until the rendered picker highlights row `index`. */
	const pickerHighlights = (index: number) =>
		until(() => expect(rendered[rendered.length - 1]?.selectedIndex).toBe(index))
	return { ...view, submitted, lastState, pickerShows, pickerHighlights }
}

describe("AutocompleteInput with an external PickerSelect", () => {
	it("keeps delivering keystrokes to the prompt while the picker is open", async () => {
		const { stdin, lastFrame, lastState, pickerShows } = renderHarness()

		await type(stdin, "/")
		await pickerShows(["new", "permissions", "init"])

		await type(stdin, "perm")
		await pickerShows(["permissions"])

		// The typed characters landed in the prompt and narrowed the list.
		await until(() => expect(plain(lastFrame())).toContain("/perm"))
		expect(lastState().isOpen).toBe(true)
	})

	it("lets Enter accept the highlighted item instead of submitting", async () => {
		const { stdin, lastFrame, submitted, lastState, pickerShows } = renderHarness()

		await type(stdin, "/perm")
		await pickerShows(["permissions"])
		stdin.write("\r")

		// The picker is gone and the prompt holds the accepted command. ink
		// trims the trailing space of the replacement text from the frame; the
		// submit test below proves it is there. Only one handler accepted the
		// item: the text was replaced exactly once.
		await until(() => {
			expect(lastState().isOpen).toBe(false)
			expect(plain(lastFrame())).toBe("/permissions")
		})
		expect(submitted).toEqual([])
	})

	it("submits /permissions ask as one line once the picker has closed", async () => {
		const { stdin, lastFrame, submitted, lastState, pickerShows } = renderHarness()

		await type(stdin, "/perm")
		await pickerShows(["permissions"])
		stdin.write("\r")
		await until(() => expect(lastState().isOpen).toBe(false))

		await type(stdin, "ask")
		await until(() => expect(plain(lastFrame())).toBe("/permissions ask"))
		expect(lastState().isOpen).toBe(false)

		stdin.write("\r")
		await until(() => expect(submitted).toEqual(["/permissions ask"]))
	})

	it("moves the highlight with the arrow keys while the picker is open", async () => {
		const { stdin, lastState, lastFrame, pickerShows, pickerHighlights } = renderHarness()

		await type(stdin, "/")
		await pickerShows(["new", "permissions", "init"])
		stdin.write("\x1b[B")
		await pickerHighlights(1)
		expect(lastState().selectedIndex).toBe(1)

		stdin.write("\r")
		await until(() => {
			expect(lastState().isOpen).toBe(false)
			expect(plain(lastFrame())).toBe("/permissions")
		})
	})

	// The real chain is longer than a useState host: the index goes into the
	// input's picker state, comes back through onPickerStateChange in a passive
	// effect, and only then reaches PickerSelect as a prop. Keys written back to
	// back must not wait for that round trip.
	it("accepts the third command after down, down, Enter written back to back", async () => {
		const { stdin, lastState, lastFrame, pickerShows } = renderHarness()

		await type(stdin, "/")
		await pickerShows(["new", "permissions", "init"])
		stdin.write("\x1b[B")
		stdin.write("\x1b[B")
		stdin.write("\r")

		await until(() => {
			expect(lastState().isOpen).toBe(false)
			expect(plain(lastFrame())).toBe("/init")
		})
	})

	it("closes the picker on Escape without clearing the prompt", async () => {
		const { stdin, lastState, lastFrame, pickerShows } = renderHarness()

		await type(stdin, "/perm")
		await pickerShows(["permissions"])
		stdin.write("\x1b")

		await until(() => expect(lastState().isOpen).toBe(false))
		expect(plain(lastFrame())).toContain("/perm")
	})
})
