// Characterization (WEB-3): which Prompts settings go to the host at once and
// which wait for Save. The task-history checkbox and the enhancement profile
// are written immediately; the support prompt texts stay in the Save buffer.
import { screen, fireEvent } from "@/utils/test-utils"

import { SETTINGS_DEFAULTS } from "@tumble-code/types"

import PromptsSettings from "../PromptsSettings"
import { renderWithSettingsDraft } from "./settingsDraftTestUtils"
import { LabeledCheckbox as RealLabeledCheckbox } from "@/components/ui/labeled-checkbox"
import { Textarea as RealTextarea } from "@/components/ui/textarea"

const { mockPostMessage, mockSetEnhancementApiConfigId, mockLiveState } = vi.hoisted(() => ({
	mockPostMessage: vi.fn(),
	mockSetEnhancementApiConfigId: vi.fn(),
	mockLiveState: { includeTaskHistoryInEnhance: true as boolean | undefined },
}))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: mockPostMessage } }))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		listApiConfigMeta: [{ id: "p1", name: "work" }],
		enhancementApiConfigId: "",
		setEnhancementApiConfigId: mockSetEnhancementApiConfigId,
		includeTaskHistoryInEnhance: mockLiveState.includeTaskHistoryInEnhance,
		setIncludeTaskHistoryInEnhance: vi.fn(),
	}),
	useExtensionSelector: (selector: (s: never) => unknown) =>
		selector({
			listApiConfigMeta: [{ id: "p1", name: "work" }],
			enhancementApiConfigId: "",
			setEnhancementApiConfigId: mockSetEnhancementApiConfigId,
			includeTaskHistoryInEnhance: mockLiveState.includeTaskHistoryInEnhance,
			setIncludeTaskHistoryInEnhance: vi.fn(),
		} as never),
}))

vi.mock("@src/components/ui", () => ({
	// The real checkbox (a native input), not a stub: only the barrel is mocked.
	LabeledCheckbox: (props: any) => <RealLabeledCheckbox {...props} />,
	Textarea: (props: any) => <RealTextarea {...props} />,
	Button: ({ children, onClick, ...props }: any) => (
		<button onClick={onClick} {...props}>
			{children}
		</button>
	),
	StandardTooltip: ({ children }: any) => <>{children}</>,
	Select: ({ children, value, onValueChange }: any) => (
		<select data-testid={`select-${value}`} value={value} onChange={(e) => onValueChange?.(e.target.value)}>
			{children}
		</select>
	),
	SelectTrigger: () => null,
	SelectValue: () => null,
	SelectContent: ({ children }: any) => <>{children}</>,
	SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

describe("PromptsSettings immediate writes (WEB-3)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockLiveState.includeTaskHistoryInEnhance = true
	})

	it("posts includeTaskHistoryInEnhance immediately and also sets the Save buffer", () => {
		const { setField } = renderWithSettingsDraft(<PromptsSettings />, {
			customSupportPrompts: {},
			includeTaskHistoryInEnhance: true,
		})

		fireEvent.click(screen.getByRole("checkbox", { name: "prompts:supportPrompts.enhance.includeTaskHistory" }))

		expect(setField).toHaveBeenCalledWith("includeTaskHistoryInEnhance", false)
		expect(mockPostMessage.mock.calls.map(([message]) => message)).toEqual([
			{ type: "updateSettings", updatedSettings: { includeTaskHistoryInEnhance: false } },
		])
	})

	it("posts the enhancement profile immediately through its own message", () => {
		renderWithSettingsDraft(<PromptsSettings />, { customSupportPrompts: {} })

		fireEvent.change(screen.getByTestId("select--"), { target: { value: "p1" } })

		expect(mockSetEnhancementApiConfigId).toHaveBeenCalledWith("p1")
		expect(mockPostMessage.mock.calls.map(([message]) => message)).toEqual([
			{ type: "enhancementApiConfigId", text: "p1" },
		])
	})

	// Neither the buffer nor the live state has a value (before the first host
	// push): the checkbox shows the schema default, the single source.
	it("falls back to the schema default for includeTaskHistoryInEnhance", () => {
		mockLiveState.includeTaskHistoryInEnhance = undefined
		renderWithSettingsDraft(<PromptsSettings />, { customSupportPrompts: {} })

		const checkbox = screen.getByRole("checkbox", {
			name: "prompts:supportPrompts.enhance.includeTaskHistory",
		}) as HTMLInputElement
		expect(checkbox.checked).toBe(SETTINGS_DEFAULTS.includeTaskHistoryInEnhance)
	})

	// The first text area is the support prompt, the second the enhancement test input.
	it("keeps an edited support prompt in the Save buffer without posting", () => {
		const { setField } = renderWithSettingsDraft(<PromptsSettings />, { customSupportPrompts: {} })

		fireEvent.input(document.querySelectorAll("textarea")[0], { target: { value: "be brief" } })

		expect(setField).toHaveBeenCalledWith("customSupportPrompts", { ENHANCE: "be brief" })
		expect(mockPostMessage).not.toHaveBeenCalled()
	})
})
