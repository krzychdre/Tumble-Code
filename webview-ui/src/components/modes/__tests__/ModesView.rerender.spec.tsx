// Regression (DEP-9): ModesView saves its prompt text areas and the description
// field on `change`, i.e. when the field loses focus. The toolkit's React
// wrapper wrote the `value` prop into the element on EVERY re-render, so any
// re-render while the user was still typing (an extension state push from a
// running task) put the saved text back, and leaving the field then saved that
// old text instead of the typed one.

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

describe("ModesView fields keep typed text across re-renders", () => {
	it.each([
		{ testId: "code-prompt-textarea", tag: "textarea" as const, key: "roleDefinition" },
		{ testId: "code-description-textfield", tag: "input" as const, key: "description" },
	])("$key: keeps the typed text and saves it when the field is left", async ({ testId, tag, key }) => {
		const { getByTestId, rerender } = render(view({}))
		const host = getByTestId(testId)
		// The native control: inside the toolkit host's shadow root, or the element itself.
		const control = (host.shadowRoot?.querySelector(tag) ?? host.querySelector(tag) ?? host) as
			HTMLInputElement | HTMLTextAreaElement
		const prototype = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype

		act(() => {
			Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, "Typed text.")
			control.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
		})
		// An unrelated extension state push re-renders ModesView while the user types.
		rerender(view({ mcpServers: [{ name: "github" }] }))
		await act(async () => {})

		expect(control.value).toBe("Typed text.")

		fireEvent.change(control)
		fireEvent.blur(control)
		const updates = vi
			.mocked(vscode.postMessage)
			.mock.calls.map(([m]) => m as any)
			.filter((m) => m.type === "updatePrompt")
		expect(updates.at(-1)?.customPrompt?.[key]).toBe("Typed text.")
	})
})
