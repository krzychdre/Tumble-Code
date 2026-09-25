import { useLayoutEffect } from "react"
import { act, render, screen, waitFor } from "@/utils/test-utils"

import i18next from "../setup"
import TranslationProvider, { useAppTranslation } from "../TranslationContext"

// The provider reads the language from the extension state. A mutable object lets a
// test start in one language and switch to another, like the settings view does.
const extensionState = { language: "en", didHydrateState: true }

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => extensionState,
}))

// Records the text of every committed render, so a test can prove no render ever
// showed a raw key or the English fallback before the active locale arrived.
const committedTexts: string[] = []

const TestComponent = () => {
	const { t } = useAppTranslation()
	const yes = t("common:answers.yes")
	const ago = t("common:time_ago.seconds_ago", { count: 5 })

	useLayoutEffect(() => {
		committedTexts.push(yes)
	})

	return (
		<div>
			<h1 data-testid="translation-test">{yes}</h1>
			<p data-testid="translation-interpolation">{ago}</p>
		</div>
	)
}

const renderProvider = () =>
	render(
		<TranslationProvider>
			<TestComponent />
		</TranslationProvider>,
	)

describe("TranslationContext", () => {
	beforeEach(async () => {
		committedTexts.length = 0
		extensionState.language = "en"
		extensionState.didHydrateState = true
		await i18next.changeLanguage("en")
	})

	it("should provide translations via context", () => {
		renderProvider()

		expect(screen.getByTestId("translation-test")).toHaveTextContent("Yes")
	})

	it("should handle interpolation correctly", () => {
		renderProvider()

		expect(screen.getByTestId("translation-interpolation")).toHaveTextContent("5 seconds ago")
	})

	describe("lazy locales", () => {
		it("keeps only English in the startup bundle", () => {
			// English is the fallback and must be there synchronously; the other
			// locales are separate chunks fetched on demand.
			expect(i18next.hasResourceBundle("en", "common")).toBe(true)
			expect(i18next.hasResourceBundle("ja", "common")).toBe(false)
		})

		it("loads the active locale before the first render, without flashing keys or English", async () => {
			extensionState.language = "de"

			renderProvider()

			await waitFor(() => expect(screen.getByTestId("translation-test")).toHaveTextContent("Ja"))
			expect(i18next.hasResourceBundle("de", "common")).toBe(true)
			expect(committedTexts).not.toContain("common:answers.yes")
			expect(committedTexts).not.toContain("answers.yes")
			expect(committedTexts).not.toContain("Yes")
		})

		it("loads and renders a new locale when the language changes", async () => {
			const { rerender } = renderProvider()
			expect(screen.getByTestId("translation-test")).toHaveTextContent("Yes")

			extensionState.language = "pl"
			await act(async () => {
				rerender(
					<TranslationProvider>
						<TestComponent />
					</TranslationProvider>,
				)
			})

			await waitFor(() => expect(screen.getByTestId("translation-test")).toHaveTextContent("Tak"))
			expect(screen.getByTestId("translation-interpolation")).toHaveTextContent("5 sekund temu")
			expect(committedTexts).not.toContain("common:answers.yes")
		})

		it("falls back to English for a key the active locale does not have", async () => {
			extensionState.language = "pl"
			renderProvider()
			await waitFor(() => expect(screen.getByTestId("translation-test")).toHaveTextContent("Tak"))

			// Simulate a namespace missing from the Polish locale.
			i18next.removeResourceBundle("pl", "common")

			expect(i18next.t("common:answers.yes")).toBe("Yes")
		})
	})
})
