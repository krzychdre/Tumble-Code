import { act, fireEvent, render, screen } from "@/utils/test-utils"
import { Settings } from "lucide-react"

import { SettingsSearch } from "../SettingsSearch"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const INDEX = [
	{ settingId: "alpha-model", section: "providers" as const, label: "Alpha model", sectionLabel: "Providers" },
	{ settingId: "alpha-key", section: "providers" as const, label: "Alpha key", sectionLabel: "Providers" },
]

const highlighted = () =>
	screen
		.queryAllByRole("option")
		.filter((option) => option.getAttribute("aria-selected") === "true")
		.map((option) => option.id)

describe("SettingsSearch highlight", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it("highlights the first result, keeps a highlight that still matches and drops it when closed", () => {
		render(<SettingsSearch index={INDEX} onNavigate={vi.fn()} sections={[{ id: "providers", icon: Settings }]} />)
		const input = screen.getByTestId("settings-search-input")
		const type = (value: string) => fireEvent.change(input, { target: { value } })

		fireEvent.focus(input)
		type("alpha")
		expect(highlighted()).toEqual(["settings-search-result-alpha-model"])

		fireEvent.keyDown(input, { key: "ArrowDown" })
		expect(highlighted()).toEqual(["settings-search-result-alpha-key"])

		type("alpha k")
		expect(highlighted()).toEqual(["settings-search-result-alpha-key"])

		type("alpha m")
		expect(highlighted()).toEqual(["settings-search-result-alpha-model"])

		type("alpha")
		fireEvent.keyDown(input, { key: "ArrowDown" })
		expect(highlighted()).toEqual(["settings-search-result-alpha-key"])
		// Leaving the field closes the dropdown a moment later.
		fireEvent.blur(input)
		act(() => vi.advanceTimersByTime(200))
		fireEvent.focus(input)
		expect(highlighted()).toEqual(["settings-search-result-alpha-model"])
	})
})
