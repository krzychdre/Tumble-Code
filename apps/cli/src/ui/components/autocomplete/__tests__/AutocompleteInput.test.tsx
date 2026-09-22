import { useMemo, useRef, useState } from "react"
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

/** Yield to React so a written keypress is processed and the frame flushes. */
function flush(ms = 10): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The slash trigger debounces its search; wait past that. */
function settle(): Promise<void> {
	return flush(200)
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
}: {
	onSubmit: (value: string) => void
	onPickerState: (state: AutocompletePickerState<SlashCommandResult>) => void
}) {
	const ref = useRef<AutocompleteInputHandle<SlashCommandResult>>(null)
	const [pickerState, setPickerState] = useState<AutocompletePickerState<SlashCommandResult> | null>(null)
	const triggers = useMemo(() => [createSlashCommandTrigger({ getCommands: () => commands })], [])

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
	const view = render(<Harness onSubmit={(v) => submitted.push(v)} onPickerState={(s) => states.push(s)} />)
	const lastState = () => {
		const state = states[states.length - 1]
		if (!state) throw new Error("picker state was never reported")
		return state
	}
	return { ...view, submitted, lastState }
}

describe("AutocompleteInput with an external PickerSelect", () => {
	it("keeps delivering keystrokes to the prompt while the picker is open", async () => {
		const { stdin, lastFrame, lastState } = renderHarness()

		await type(stdin, "/")
		await settle()
		expect(lastState().isOpen).toBe(true)
		expect(lastState().results.map((r) => r.name)).toEqual(["new", "permissions", "init"])

		await type(stdin, "perm")
		await settle()

		// The typed characters landed in the prompt and narrowed the list.
		expect(plain(lastFrame())).toContain("/perm")
		expect(lastState().isOpen).toBe(true)
		expect(lastState().results.map((r) => r.name)).toEqual(["permissions"])
	})

	it("lets Enter accept the highlighted item instead of submitting", async () => {
		const { stdin, lastFrame, submitted, lastState } = renderHarness()

		await type(stdin, "/perm")
		await settle()
		stdin.write("\r")
		await settle()

		expect(submitted).toEqual([])
		expect(lastState().isOpen).toBe(false)
		// The picker is gone and the prompt holds the accepted command. ink
		// trims the trailing space of the replacement text from the frame; the
		// submit test below proves it is there. Only one handler accepted the
		// item: the text was replaced exactly once.
		expect(plain(lastFrame())).toBe("/permissions")
	})

	it("submits /permissions ask as one line once the picker has closed", async () => {
		const { stdin, submitted, lastState } = renderHarness()

		await type(stdin, "/perm")
		await settle()
		stdin.write("\r")
		await settle()
		await type(stdin, "ask")
		await settle()

		expect(lastState().isOpen).toBe(false)

		stdin.write("\r")
		await settle()

		expect(submitted).toEqual(["/permissions ask"])
	})

	it("moves the highlight with the arrow keys while the picker is open", async () => {
		const { stdin, lastState, lastFrame } = renderHarness()

		await type(stdin, "/")
		await settle()
		stdin.write("\x1b[B")
		await settle()

		expect(lastState().selectedIndex).toBe(1)

		stdin.write("\r")
		await settle()

		expect(lastState().isOpen).toBe(false)
		expect(plain(lastFrame())).toBe("/permissions")
	})

	it("closes the picker on Escape without clearing the prompt", async () => {
		const { stdin, lastState, lastFrame } = renderHarness()

		await type(stdin, "/perm")
		await settle()
		stdin.write("\x1b")
		await settle()

		expect(lastState().isOpen).toBe(false)
		expect(plain(lastFrame())).toContain("/perm")
	})
})
