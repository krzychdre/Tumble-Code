import { screen } from "@/utils/test-utils"

import { TranslationProvider } from "@/i18n/__mocks__/TranslationContext"

import { About } from "../About"
import { renderWithSettingsDraft } from "./settingsDraftTestUtils"

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@/i18n/TranslationContext", () => {
	const actual = vi.importActual("@/i18n/TranslationContext")
	return {
		...actual,
		useAppTranslation: () => ({
			t: (key: string) => key,
		}),
	}
})

vi.mock("@roo/package", () => ({
	Package: {
		version: "1.0.0",
		sha: "abc12345",
	},
}))

describe("About", () => {
	const defaultDraft = { debug: false }

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the About section header", () => {
		renderWithSettingsDraft(
			<TranslationProvider>
				<About />
			</TranslationProvider>,
			defaultDraft,
		)
		expect(screen.getByText("settings:sections.about")).toBeInTheDocument()
	})

	it("displays version information", () => {
		renderWithSettingsDraft(
			<TranslationProvider>
				<About />
			</TranslationProvider>,
			defaultDraft,
		)
		expect(screen.getByText(/Version: 1\.0\.0/)).toBeInTheDocument()
	})

	it("has no Contact & Community section linking to upstream Roo Code", () => {
		const { container } = renderWithSettingsDraft(
			<TranslationProvider>
				<About />
			</TranslationProvider>,
			defaultDraft,
		)
		expect(screen.queryByText("settings:about.contactAndCommunity")).not.toBeInTheDocument()
		const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "")
		expect(hrefs.filter((href) => /roo-?code|reddit\.com|discord\.gg/i.test(href))).toEqual([])
	})

	it("keeps the debug mode toggle", () => {
		renderWithSettingsDraft(
			<TranslationProvider>
				<About />
			</TranslationProvider>,
			defaultDraft,
		)
		expect(screen.getAllByText("settings:about.debugMode.label").length).toBeGreaterThan(0)
	})

	it("renders export, import, and reset buttons", () => {
		renderWithSettingsDraft(
			<TranslationProvider>
				<About />
			</TranslationProvider>,
			defaultDraft,
		)
		expect(screen.getByText("settings:footer.settings.export")).toBeInTheDocument()
		expect(screen.getByText("settings:footer.settings.import")).toBeInTheDocument()
		expect(screen.getByText("settings:footer.settings.reset")).toBeInTheDocument()
	})
})
