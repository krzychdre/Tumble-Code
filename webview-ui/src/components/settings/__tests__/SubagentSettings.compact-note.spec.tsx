import { render, screen } from "@testing-library/react"

import type { CachedSettings } from "../schema"
import { SettingsDraftProvider } from "../SettingsDraftContext"
import { createSettingsDraftStore } from "../settingsDraftStore"
import { SubagentSettings } from "../SubagentSettings"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const renderTab = (initial: Partial<CachedSettings>) =>
	render(
		<SettingsDraftProvider value={createSettingsDraftStore(initial as CachedSettings)}>
			<SubagentSettings />
		</SettingsDraftProvider>,
	)

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
