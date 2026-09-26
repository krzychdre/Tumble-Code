// Characterization of the webview's VSCodeTextArea call sites (refactor DEP-9:
// the deprecated toolkit text area is being replaced). The toolkit is NOT
// mocked. Its native <textarea> lives in the host's shadow root, so the helpers
// reach it there, or take the replacement's light-DOM textarea.
//
// What is pinned is WHEN each call site hears about typing: the sites with
// `onChange` (ModesView prompts and global instructions, CreateModeDialog,
// the enhancement test prompt) only on `change`, i.e. when the field is left;
// the sites with `onInput` (support prompts, condense prompt) on every
// keystroke.

import React from "react"

import { act, fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import ModesView from "@src/components/modes/ModesView"
import { CreateModeDialog } from "@src/components/modes/CreateModeDialog"
import PromptsSettings from "@src/components/settings/PromptsSettings"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: any) => <span data-i18n={i18nKey}>{children}</span>,
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const baseState = {
	customModePrompts: {},
	listApiConfigMeta: [{ id: "p1", name: "work" }],
	mode: "code",
	customModes: [],
	currentApiConfigName: "",
	customInstructions: "",
	setCustomInstructions: vi.fn(),
	mcpServers: [],
	enhancementApiConfigId: "",
	setEnhancementApiConfigId: vi.fn(),
	includeTaskHistoryInEnhance: true,
	setIncludeTaskHistoryInEnhance: vi.fn(),
}

const withState = (ui: React.ReactElement, state: Record<string, unknown> = {}) => (
	<ExtensionStateContext.Provider value={{ ...baseState, ...state } as any}>{ui}</ExtensionStateContext.Provider>
)

/** The native text area of a call site: in the toolkit host's shadow root, or the element itself. */
const control = (el: Element) =>
	(el.shadowRoot?.querySelector("textarea") ?? el.querySelector("textarea") ?? el) as HTMLTextAreaElement

/** Every text area on the page, in document order (toolkit hosts or replacements). */
const textAreas = () =>
	[...document.querySelectorAll("vscode-text-area, textarea")]
		.filter((el) => el.tagName !== "TEXTAREA" || !el.closest("vscode-text-area"))
		.map(control)

/** Types like a user whose caret stays in the field: sets the text and fires `input`. */
const type = (el: HTMLTextAreaElement, text: string) =>
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, text)
		el.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
	})

/** Leaves the field after editing: the native `change` event. */
const leave = (el: HTMLTextAreaElement) => fireEvent.change(el)

const posted = (type: string) =>
	vi
		.mocked(vscode.postMessage)
		.mock.calls.map(([m]) => m as any)
		.filter((m) => m.type === type)

describe("VSCodeTextArea call sites: ModesView", () => {
	beforeEach(() => vi.mocked(vscode.postMessage).mockClear())

	it("role definition: shows the mode's text, saves nothing while typing and the trimmed text when left", async () => {
		render(withState(<ModesView onSelectApiConfiguration={vi.fn()} />))
		const role = control(screen.getByTestId("code-prompt-textarea"))

		await waitFor(() => expect(role.getAttribute("rows")).toBe("5"))
		expect(role.value).not.toBe("")

		type(role, "  You review code.  ")
		expect(posted("updatePrompt")).toEqual([])

		leave(role)
		expect(posted("updatePrompt").at(-1)).toEqual({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: { roleDefinition: "You review code." },
		})
	})

	it("global custom instructions: posted when the field is left, not per keystroke", async () => {
		const setCustomInstructions = vi.fn()
		render(
			withState(<ModesView onSelectApiConfiguration={vi.fn()} />, {
				customInstructions: "Be brief.",
				setCustomInstructions,
			}),
		)
		const field = control(screen.getByTestId("global-custom-instructions-textarea"))

		await waitFor(() => expect(field.value).toBe("Be brief."))
		expect(field.getAttribute("rows")).toBe("4")

		type(field, "Be very brief.")
		expect(posted("customInstructions")).toEqual([])
		expect(setCustomInstructions).not.toHaveBeenCalled()

		leave(field)
		expect(posted("customInstructions")).toEqual([{ type: "customInstructions", text: "Be very brief." }])
		expect(setCustomInstructions).toHaveBeenCalledWith("Be very brief.")
	})

	it("a new value from the extension replaces the shown text", async () => {
		const { rerender } = render(
			withState(<ModesView onSelectApiConfiguration={vi.fn()} />, { customInstructions: "Old." }),
		)
		rerender(withState(<ModesView onSelectApiConfiguration={vi.fn()} />, { customInstructions: "New." }))

		await waitFor(() =>
			expect(control(screen.getByTestId("global-custom-instructions-textarea")).value).toBe("New."),
		)
		expect(posted("customInstructions")).toEqual([])
	})
})

describe("VSCodeTextArea call site: CreateModeDialog", () => {
	it("the role definition, when to use and custom instructions reach the created mode", async () => {
		const onCreate = vi.fn()
		render(<CreateModeDialog modes={[]} mcpServers={[]} onCreate={onCreate} onClose={() => {}} />)
		await waitFor(() => expect(textAreas()[0].getAttribute("rows")).toBe("4"))
		const [role, whenToUse, instructions] = textAreas()

		expect(whenToUse.getAttribute("rows")).toBe("3")
		type(role, "You are a tester.")
		leave(role)
		type(whenToUse, "When testing.")
		leave(whenToUse)
		type(instructions, "Write specs first.")
		leave(instructions)
		fireEvent.change(
			screen.getByText("prompts:createModeDialog.name.label").parentElement!.querySelector("input")!,
			{
				target: { value: "Tester" },
			},
		)
		fireEvent.click(screen.getByText("prompts:createModeDialog.buttons.create"))

		expect(onCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				roleDefinition: "You are a tester.",
				whenToUse: "When testing.",
				customInstructions: "Write specs first.",
			}),
		)
	})
})

describe("VSCodeTextArea call sites: PromptsSettings", () => {
	it("the support prompt is reported on every keystroke, before the field is left", async () => {
		const setCustomSupportPrompts = vi.fn()
		render(
			withState(<PromptsSettings customSupportPrompts={{}} setCustomSupportPrompts={setCustomSupportPrompts} />),
		)
		await waitFor(() => expect(textAreas()[0].getAttribute("rows")).toBe("6"))
		const [support] = textAreas()
		type(support, "Improve: ${userInput}")

		expect(setCustomSupportPrompts).toHaveBeenLastCalledWith(
			expect.objectContaining({ ENHANCE: "Improve: ${userInput}" }),
		)
	})
})
