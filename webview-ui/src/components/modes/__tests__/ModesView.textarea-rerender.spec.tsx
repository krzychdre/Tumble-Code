// Regression (DEP-9 text area slice): ModesView saves its prompt text areas on
// `change`, i.e. when the field loses focus. The toolkit's React wrapper wrote
// the `value` prop into the element on EVERY re-render, so any re-render while
// the user was still typing (for example an extension state push from a
// running task) put the saved text back into the element's value, and leaving
// the field then saved that old text instead of the typed one.

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

/** The native text area: inside the toolkit host's shadow root, or the element itself. */
const control = (el: Element) =>
	(el.shadowRoot?.querySelector("textarea") ?? el.querySelector("textarea") ?? el) as HTMLTextAreaElement

const typeWithoutLeaving = (el: HTMLTextAreaElement, text: string) => {
	Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, text)
	el.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
}

describe("ModesView prompt text areas and re-renders", () => {
	it("keeps the typed role definition across a re-render and saves it when the field is left", async () => {
		const { getByTestId, rerender } = render(view({}))
		const textarea = control(getByTestId("code-prompt-textarea"))

		act(() => typeWithoutLeaving(textarea, "You are a careful reviewer."))
		// An unrelated extension state push re-renders ModesView while the user types.
		rerender(view({ mcpServers: [{ name: "github" }] }))
		await act(async () => {})

		expect(textarea.value).toBe("You are a careful reviewer.")

		fireEvent.change(textarea)
		const updates = vi
			.mocked(vscode.postMessage)
			.mock.calls.map(([m]) => m as any)
			.filter((m) => m.type === "updatePrompt")
		expect(updates.at(-1)?.customPrompt?.roleDefinition).toBe("You are a careful reviewer.")
	})
})
