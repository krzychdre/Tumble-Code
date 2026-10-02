/**
 * P1 selector-hook specs: correct slices, render-skipping on unrelated
 * changes, stable action identities, and the no-provider error.
 */
import React from "react"
import { render, act } from "@/utils/test-utils"

import type { ExtensionMessage } from "@tumble-code/types"

import { vscode } from "@src/utils/vscode"

import { ExtensionStateContextProvider, useExtensionState, useExtensionSelector } from "../ExtensionStateContext"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

const dispatch = (message: ExtensionMessage) => {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: message }))
	})
}

const dispatchState = (state: Record<string, unknown>) => dispatch({ type: "state", state: state as never })

describe("useExtensionSelector", () => {
	beforeEach(() => {
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("returns the selected slice and observes updates to it", () => {
		let selected: string | undefined
		const Probe = () => {
			selected = useExtensionSelector((s) => s.cwd)
			return null
		}

		render(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)
		expect(selected).toBe("")

		dispatchState({ cwd: "/a" })
		expect(selected).toBe("/a")

		dispatchState({ cwd: "/b" })
		expect(selected).toBe("/b")
	})

	it("does not re-render a consumer whose slice did not change", () => {
		let renders = 0
		const Probe = () => {
			renders++
			useExtensionSelector((s) => s.soundEnabled ?? false)
			return null
		}

		render(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)
		const baseline = renders

		// Three updates that touch other slices entirely.
		dispatchState({ cwd: "/a", clineMessages: [], clineMessagesSeq: 1 })
		dispatchState({ cwd: "/b", clineMessages: [], clineMessagesSeq: 2 })
		dispatchState({
			clineMessages: [{ type: "say", say: "text", ts: 1, text: "x", partial: true }],
			clineMessagesSeq: 3,
		})

		expect(renders).toBe(baseline)

		// An update to the selected slice does re-render.
		dispatchState({ soundEnabled: true })
		expect(renders).toBe(baseline + 1)
	})

	it("supports a custom isEqual for multi-value slices", () => {
		let renders = 0
		let value: [boolean, string] | undefined
		const shallowArrayEqual = (a: [boolean, string], b: [boolean, string]) =>
			a.length === b.length && a.every((item, i) => Object.is(item, b[i]))

		const Probe = () => {
			renders++
			value = useExtensionSelector((s) => [s.soundEnabled ?? false, s.language ?? "en"], shallowArrayEqual)
			return null
		}

		render(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)
		const baseline = renders

		// Unrelated churn: the tuple is rebuilt per commit, but shallow-equal.
		dispatchState({ cwd: "/a", clineMessages: [], clineMessagesSeq: 1 })
		dispatchState({ cwd: "/b", clineMessages: [], clineMessagesSeq: 2 })

		expect(renders).toBe(baseline)

		// A real change to a tuple member re-renders.
		dispatchState({ language: "pl" })
		expect(renders).toBe(baseline + 1)
		expect(value).toEqual([false, "pl"])
	})

	it("keeps action identities stable across commits", () => {
		const first: Record<string, unknown> = {}
		const Probe = () => {
			const state = useExtensionState()
			if (first.setMode === undefined) {
				for (const key of [
					"setMode",
					"setApiConfiguration",
					"togglePinnedApiConfig",
					"clearSubagents",
				] as const) {
					first[key] = state[key]
				}
			} else {
				expect(state.setMode).toBe(first.setMode)
				expect(state.setApiConfiguration).toBe(first.setApiConfiguration)
				expect(state.togglePinnedApiConfig).toBe(first.togglePinnedApiConfig)
				expect(state.clearSubagents).toBe(first.clearSubagents)
			}
			return null
		}

		render(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)
		dispatchState({ cwd: "/a", clineMessages: [], clineMessagesSeq: 1 })
		dispatchState({ cwd: "/b", mode: "architect", clineMessages: [], clineMessagesSeq: 2 })
	})

	it("actions mutate the store and reach useExtensionState consumers", () => {
		let mode: string | undefined
		let setMode: ((value: never) => void) | undefined
		const Probe = () => {
			const state = useExtensionState()
			mode = state.mode
			setMode = state.setMode
			return null
		}

		render(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)
		dispatchState({ mode: "code" })
		expect(mode).toBe("code")

		act(() => {
			setMode!("architect" as never)
		})
		expect(mode).toBe("architect")
	})

	it("a changed store produces a new value; the selector cache keeps slices stable", () => {
		const values: unknown[] = []
		let soundRenders = 0
		const Probe = () => {
			values.push(useExtensionState())
			return null
		}
		const SoundProbe = () => {
			soundRenders++
			useExtensionSelector((s) => s.soundEnabled ?? false)
			return null
		}

		render(
			<ExtensionStateContextProvider>
				<Probe />
				<SoundProbe />
			</ExtensionStateContextProvider>,
		)
		const before = values[values.length - 1]
		dispatchState({ cwd: "/same" })
		// The store object changed (merge always builds a new state), so the
		// legacy value identity changed too.
		expect(values[values.length - 1]).not.toBe(before)
		// ...but the selector consumer did not re-render.
		const baseline = soundRenders
		dispatchState({ cwd: "/other" })
		expect(soundRenders).toBe(baseline)
	})

	it("useExtensionSelector throws outside a provider", () => {
		const Probe = () => {
			useExtensionSelector((s) => s.cwd)
			return null
		}
		expect(() => render(<Probe />)).toThrow(/must be used within an ExtensionStateContextProvider/)
	})
})
