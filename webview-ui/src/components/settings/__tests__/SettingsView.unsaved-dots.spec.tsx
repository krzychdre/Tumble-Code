// §2.10 (ai_plans/2026-09-27_ui-modernization.md): a dot on the Save button
// and on each tab that has unsaved edits, and tab triggers keep their focus
// ring (no `focus:ring-0`).
//
// Real sections over the real Save buffer; only the host, the translations
// and the Providers tab are replaced (same harness as the draft-buffer spec).

import { fireEvent, render, screen, within } from "@/utils/test-utils"

import SettingsView from "../SettingsView"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

const mockState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockState.current,
	useExtensionSelector: (selector: (s: never) => unknown) => selector(mockState.current as never),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey }: { i18nKey?: string }) => <span>{i18nKey}</span>,
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("../ApiConfigManager", () => ({ default: () => null }))
vi.mock("../ApiOptions", () => ({ default: () => null }))
vi.mock("../SettingsSearch", () => ({ SettingsSearch: () => null }))

const baseState = () => ({
	currentApiConfigName: "default",
	listApiConfigMeta: [{ id: "p1", name: "default", apiProvider: "anthropic" }],
	uriScheme: "vscode",
	settingsImportedAt: undefined,
	apiConfiguration: { apiProvider: "anthropic" },
	debug: false,
	webToolsEnabled: false,
	searxngBaseUrl: "http://searx.local",
	webSearchMaxResults: 7,
	soundEnabled: false,
	soundVolume: 0.4,
	experiments: {},
	language: "en",
})

const openTab = (id: string) => {
	fireEvent.click(screen.getByTestId(`tab-${id}`))
	return screen.getByTestId("settings-content")
}

const isMarked = (id: string) => screen.getByTestId(`tab-${id}`).getAttribute("data-unsaved") === "true"
const saveDot = () => within(screen.getByTestId("save-button")).queryByTestId("unsaved-dot")

describe("SettingsView unsaved-edit dots", () => {
	beforeEach(() => {
		mockState.current = baseState()
	})

	it("shows no dot before any edit", () => {
		render(<SettingsView onDone={vi.fn()} />)

		expect(saveDot()).toBeNull()
		expect(isMarked("web")).toBe(false)
		expect(within(screen.getByTestId("settings-tab-list")).queryAllByTestId("unsaved-dot")).toHaveLength(0)
	})

	it("puts a dot on Save and on the tab where the edit happened, and names it for screen readers", () => {
		render(<SettingsView onDone={vi.fn()} />)

		fireEvent.click(within(openTab("web")).getByTestId("web-tools-enabled-checkbox"))

		expect(saveDot()).not.toBeNull()
		expect(isMarked("web")).toBe(true)
		expect(isMarked("notifications")).toBe(false)
		const tab = screen.getByTestId("tab-web")
		expect(within(tab).getByTestId("unsaved-dot")).toHaveAttribute("aria-hidden", "true")
		expect(within(tab).getByText("settings:header.unsavedChanges")).toHaveClass("sr-only")
	})

	it("keeps each edited tab marked after switching tabs, and clears them all on Save", () => {
		render(<SettingsView onDone={vi.fn()} />)

		fireEvent.click(within(openTab("web")).getByTestId("web-tools-enabled-checkbox"))
		fireEvent.click(within(openTab("notifications")).getByTestId("sound-enabled-checkbox"))

		expect(isMarked("web")).toBe(true)
		expect(isMarked("notifications")).toBe(true)
		expect(isMarked("terminal")).toBe(false)

		fireEvent.click(screen.getByTestId("save-button"))

		expect(isMarked("web")).toBe(false)
		expect(isMarked("notifications")).toBe(false)
		expect(saveDot()).toBeNull()
	})

	it("keeps the 1px focus ring on the tab triggers", () => {
		render(<SettingsView onDone={vi.fn()} />)

		for (const tab of within(screen.getByTestId("settings-tab-list")).getAllByRole("tab")) {
			expect(tab).toHaveClass("focus-visible:outline-1", "focus-visible:outline-vscode-focusBorder")
		}
	})
})
