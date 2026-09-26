// Regression (DEP-9 text field slice): ModesView saves the mode description
// on `change`, i.e. when the field loses focus. The toolkit's React wrapper
// wrote the `value` prop into the element on EVERY re-render, so any re-render
// while the user was still typing (for example an extension state push from a
// running task) put the saved text back into the element's value, and leaving
// the field then saved that old text instead of the typed one. The text area
// slice fixed the same defect for the prompt text areas.

import { act, fireEvent, render } from "@/utils/test-utils"

import ModesView from "../ModesView"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: any) => <span data-i18n={i18nKey}>{children}</span>,
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

const baseState = {
	customModePrompts: {},
	listApiConfigMeta: [],
	mode: "code",
	customModes: [],
	currentApiConfigName: "",
	customInstructions: "",
	setCustomInstructions: vi.fn(),
	mcpServers: [],
}

const view = (state: Record<string, unknown>) => (
	<ExtensionStateContext.Provider value={{ ...baseState, ...state } as any}>
		<ModesView onSelectApiConfiguration={vi.fn()} />
	</ExtensionStateContext.Provider>
)

/** The native input: inside the toolkit host's shadow root, or the element itself. */
const control = (el: Element) => (el.shadowRoot?.querySelector("input") ?? el) as HTMLInputElement

const typeWithoutLeaving = (el: HTMLInputElement, text: string) => {
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text)
	el.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
}

describe("ModesView description text field and re-renders", () => {
	it("keeps the typed description across a re-render and saves it when the field is left", async () => {
		const { getByTestId, rerender } = render(view({}))
		const field = control(getByTestId("code-description-textfield"))

		act(() => typeWithoutLeaving(field, "Reviews every change."))
		// An unrelated extension state push re-renders ModesView while the user types.
		rerender(view({ mcpServers: [{ name: "github" }] }))
		await act(async () => {})

		expect(field.value).toBe("Reviews every change.")

		fireEvent.change(field)
		const updates = vi
			.mocked(vscode.postMessage)
			.mock.calls.map(([m]) => m as any)
			.filter((m) => m.type === "updatePrompt")
		expect(updates.at(-1)?.customPrompt?.description).toBe("Reviews every change.")
	})
})
