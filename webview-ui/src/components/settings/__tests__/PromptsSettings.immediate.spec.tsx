// Characterization (WEB-3): which Prompts settings go to the host at once and
// which wait for Save. The task-history checkbox and the enhancement profile
// are written immediately; the support prompt texts stay in the Save buffer.
import { render, screen, fireEvent } from "@/utils/test-utils"

import PromptsSettings from "../PromptsSettings"
import { LabeledCheckbox as RealLabeledCheckbox } from "@/components/ui/labeled-checkbox"

const { mockPostMessage, mockSetEnhancementApiConfigId } = vi.hoisted(() => ({
	mockPostMessage: vi.fn(),
	mockSetEnhancementApiConfigId: vi.fn(),
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
		includeTaskHistoryInEnhance: true,
		setIncludeTaskHistoryInEnhance: vi.fn(),
	}),
}))

vi.mock("@src/components/ui", () => ({
	// The real checkbox (a native input), not a stub: only the barrel is mocked.
	LabeledCheckbox: (props: any) => <RealLabeledCheckbox {...props} />,
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

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextArea: ({ value, onInput }: any) => (
		<textarea data-testid="support-prompt-textarea" value={value} onChange={(e) => onInput?.(e)} />
	),
}))

describe("PromptsSettings immediate writes (WEB-3)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("posts includeTaskHistoryInEnhance immediately and also sets the Save buffer", () => {
		const setIncludeTaskHistoryInEnhance = vi.fn()
		render(
			<PromptsSettings
				customSupportPrompts={{}}
				setCustomSupportPrompts={vi.fn()}
				includeTaskHistoryInEnhance={true}
				setIncludeTaskHistoryInEnhance={setIncludeTaskHistoryInEnhance}
			/>,
		)

		fireEvent.click(screen.getByRole("checkbox", { name: "prompts:supportPrompts.enhance.includeTaskHistory" }))

		expect(setIncludeTaskHistoryInEnhance).toHaveBeenCalledWith(false)
		expect(mockPostMessage.mock.calls.map(([message]) => message)).toEqual([
			{ type: "updateSettings", updatedSettings: { includeTaskHistoryInEnhance: false } },
		])
	})

	it("posts the enhancement profile immediately through its own message", () => {
		render(<PromptsSettings customSupportPrompts={{}} setCustomSupportPrompts={vi.fn()} />)

		fireEvent.change(screen.getByTestId("select--"), { target: { value: "p1" } })

		expect(mockSetEnhancementApiConfigId).toHaveBeenCalledWith("p1")
		expect(mockPostMessage.mock.calls.map(([message]) => message)).toEqual([
			{ type: "enhancementApiConfigId", text: "p1" },
		])
	})

	// The first text area is the support prompt, the second the enhancement test input.
	it("keeps an edited support prompt in the Save buffer without posting", () => {
		const setCustomSupportPrompts = vi.fn()
		render(<PromptsSettings customSupportPrompts={{}} setCustomSupportPrompts={setCustomSupportPrompts} />)

		fireEvent.change(screen.getAllByTestId("support-prompt-textarea")[0], { target: { value: "be brief" } })

		expect(setCustomSupportPrompts).toHaveBeenCalledWith({ ENHANCE: "be brief" })
		expect(mockPostMessage).not.toHaveBeenCalled()
	})
})
