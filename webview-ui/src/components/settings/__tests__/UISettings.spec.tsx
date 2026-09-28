import { act, fireEvent, waitFor } from "@/utils/test-utils"
import { describe, it, expect, vi } from "vitest"
import { LabeledCheckbox as RealLabeledCheckbox } from "@/components/ui/labeled-checkbox"

// Mock the translation hook — return the key so assertions can match on it.
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

// The real checkbox (a native input), not a stub; the barrel is mocked only
// because Radix Select needs pointer events and portals. Select becomes a
// native <select> so fireEvent.change drives onValueChange (the same stub
// MemorySettings.spec.tsx / ApiOptions.spec.tsx use). Only <option> elements
// may nest inside a native <select>, so the trigger/value/content slots
// collapse to their children (div wrappers inside a select make the browser
// drop the value).
vi.mock("@/components/ui", () => ({
	LabeledCheckbox: (props: any) => <RealLabeledCheckbox {...props} />,
	Select: ({ children, value, onValueChange }: any) => (
		<select data-testid="ui-density-native" value={value} onChange={(e) => onValueChange?.(e.target.value)}>
			{children}
		</select>
	),
	SelectTrigger: ({ children }: any) => <>{children}</>,
	SelectValue: () => null,
	SelectContent: ({ children }: any) => <>{children}</>,
	SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
}))

import { UISettings } from "../UISettings"
import type { CachedSettings } from "../schema"
import { renderWithSettingsDraft } from "./settingsDraftTestUtils"

describe("UISettings", () => {
	const defaultDraft = {
		reasoningBlockCollapsed: false,
		enterBehavior: "send" as const,
		uiDensity: "comfortable" as const,
	}
	const renderUI = (draft: Partial<CachedSettings> = {}) =>
		renderWithSettingsDraft(<UISettings />, { ...defaultDraft, ...draft })

	it("renders the collapse thinking checkbox", () => {
		const { getByTestId } = renderUI()
		const checkbox = getByTestId("collapse-thinking-checkbox")
		expect(checkbox).toBeTruthy()
	})

	it("displays the correct initial state", () => {
		const { getByTestId } = renderUI({ reasoningBlockCollapsed: true })
		const checkbox = getByTestId("collapse-thinking-checkbox") as HTMLInputElement
		expect(checkbox.checked).toBe(true)
	})

	it("calls setCachedStateField when checkbox is toggled", async () => {
		const { getByTestId, setField: setCachedStateField } = renderUI()

		const checkbox = getByTestId("collapse-thinking-checkbox")
		fireEvent.click(checkbox)

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("reasoningBlockCollapsed", true)
		})
	})

	it("updates checkbox state when the buffered value changes", () => {
		const { getByTestId, store } = renderUI({ reasoningBlockCollapsed: false })
		const checkbox = getByTestId("collapse-thinking-checkbox") as HTMLInputElement
		expect(checkbox.checked).toBe(false)

		act(() => store.setField("reasoningBlockCollapsed", true))
		expect(checkbox.checked).toBe(true)
	})

	// §2.1 density (ai_plans/2026-09-27_ui-modernization.md): the select shows
	// the buffer's value and writes it to the buffer.
	it("renders the density select with the buffered value", () => {
		const { getByTestId } = renderUI({ uiDensity: "compact" })
		const select = getByTestId("ui-density-native") as HTMLSelectElement
		expect(select.value).toBe("compact")
	})

	it("calls setCachedStateField when density changes", () => {
		const { getByTestId, setField: setCachedStateField } = renderUI()

		// The barrel mock renders the Select as a native <select>.
		fireEvent.change(getByTestId("ui-density-native"), { target: { value: "compact" } })

		expect(setCachedStateField).toHaveBeenCalledWith("uiDensity", "compact")
	})
})
