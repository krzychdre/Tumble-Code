import { fireEvent, screen } from "@testing-library/react"

import { MAX_PARALLEL_TASKS_MAX_CONCURRENCY, PARALLEL_TASKS_NO_LIMIT } from "@tumble-code/types"

import type { CachedSettings } from "../schema"
import { SubagentSettings } from "../SubagentSettings"
import { renderWithSettingsDraft } from "./settingsDraftTestUtils"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const renderTab = (initial: Partial<CachedSettings>) => renderWithSettingsDraft(<SubagentSettings />, initial).store

const concurrencyThumb = () => screen.getByTestId("subagents-max-concurrency-slider").querySelector('[role="slider"]')!

describe("SubagentSettings compact note", () => {
	it("says subagents are off when the profile being edited is compact", () => {
		renderTab({ apiConfiguration: { compactProfile: true } })

		expect(screen.getByTestId("subagents-compact-note")).toHaveTextContent("settings:subagents.compactNote")
	})

	it("shows no note for a standard or slim profile, and the global controls stay as they are", () => {
		renderTab({ apiConfiguration: { slimToolset: true, compactProfile: false } })

		expect(screen.queryByTestId("subagents-compact-note")).not.toBeInTheDocument()
		expect(screen.getByTestId("subagents-max-concurrency-slider")).toBeInTheDocument()
	})
})

describe("SubagentSettings max parallel subagents", () => {
	it("offers No limit as the step past the highest number and stores it as PARALLEL_TASKS_NO_LIMIT", () => {
		const store = renderTab({ parallelTasksMaxConcurrency: 3 })

		fireEvent.keyDown(concurrencyThumb(), { key: "End" })

		expect(store.getState().parallelTasksMaxConcurrency).toBe(PARALLEL_TASKS_NO_LIMIT)
		expect(screen.getByText("settings:subagents.maxConcurrency.noLimit")).toBeInTheDocument()
	})

	it("goes back from No limit to the highest number", () => {
		const store = renderTab({ parallelTasksMaxConcurrency: PARALLEL_TASKS_NO_LIMIT })
		expect(screen.getByText("settings:subagents.maxConcurrency.noLimit")).toBeInTheDocument()

		fireEvent.keyDown(concurrencyThumb(), { key: "ArrowLeft" })

		expect(store.getState().parallelTasksMaxConcurrency).toBe(MAX_PARALLEL_TASKS_MAX_CONCURRENCY)
		expect(screen.getByText(String(MAX_PARALLEL_TASKS_MAX_CONCURRENCY))).toBeInTheDocument()
	})
})
