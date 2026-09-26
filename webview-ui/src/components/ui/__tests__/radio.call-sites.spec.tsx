// Characterization of the webview's VSCodeRadioGroup / VSCodeRadio call site
// (refactor DEP-9: the deprecated toolkit radios are being replaced). The
// radios are the real toolkit components; only the toolkit's text inputs are
// replaced by native stand-ins so the form can be filled in jsdom.

import React from "react"

import { fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import { CreateModeDialog } from "@src/components/modes/CreateModeDialog"

vi.mock("react-i18next", async () => {
	const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next")
	return { ...actual, useTranslation: () => ({ t: (key: string) => key }) }
})

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@vscode/webview-ui-toolkit/react", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@vscode/webview-ui-toolkit/react")
	return {
		...actual,
		VSCodeTextField: ({ value, onChange, onInput, ...props }: any) => (
			<input type="text" value={value ?? ""} onChange={onChange ?? onInput} {...props} />
		),
	}
})

/** The element a user clicks for an option: the toolkit's host or the replacement's input. */
const option = (labelKey: string) => {
	const el = screen.getByText(labelKey).closest("vscode-radio, label") as HTMLElement | null
	expect(el).not.toBeNull()
	return el!
}

const isChecked = (el: HTMLElement) =>
	el.tagName === "VSCODE-RADIO"
		? el.getAttribute("aria-checked") === "true"
		: (el.querySelector("input[type=radio]") as HTMLInputElement).checked

const renderDialog = () => {
	const onCreate = vi.fn()
	render(<CreateModeDialog modes={[]} mcpServers={[]} onCreate={onCreate} onClose={() => {}} />)
	const roleDefinition = document.querySelectorAll("textarea")[0] as HTMLTextAreaElement
	fireEvent.change(roleDefinition, { target: { value: "You are a tester." } })
	return { onCreate }
}

const create = () => fireEvent.click(screen.getByText("prompts:createModeDialog.buttons.create"))

describe("VSCodeRadioGroup call site: CreateModeDialog save location", () => {
	it("starts on Global and creates a global mode", async () => {
		const { onCreate } = renderDialog()

		await waitFor(() => expect(isChecked(option("prompts:createModeDialog.saveLocation.global.label"))).toBe(true))
		expect(isChecked(option("prompts:createModeDialog.saveLocation.project.label"))).toBe(false)

		create()
		expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ source: "global" }))
	})

	it("is exposed as a radio group with two radios", async () => {
		renderDialog()

		expect(await screen.findByRole("radiogroup")).toBeInTheDocument()
		await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(2))
	})

	it("clicking Project selects it and creates a project mode; clicking Global goes back", async () => {
		const { onCreate } = renderDialog()

		fireEvent.click(option("prompts:createModeDialog.saveLocation.project.label"))
		await waitFor(() => expect(isChecked(option("prompts:createModeDialog.saveLocation.project.label"))).toBe(true))
		expect(isChecked(option("prompts:createModeDialog.saveLocation.global.label"))).toBe(false)

		create()
		expect(onCreate).toHaveBeenLastCalledWith(expect.objectContaining({ source: "project" }))

		fireEvent.click(option("prompts:createModeDialog.saveLocation.global.label"))
		await waitFor(() => expect(isChecked(option("prompts:createModeDialog.saveLocation.global.label"))).toBe(true))

		create()
		expect(onCreate).toHaveBeenLastCalledWith(expect.objectContaining({ source: "global" }))
	})
})
