import { render, screen, fireEvent } from "@testing-library/react"

import { ModelSizeControl, modelSizeOf } from "../ModelSizeControl"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"settings:advanced.modelSize.title": "Model size",
				"settings:advanced.modelSize.description":
					"How much system prompt and how many tools this profile sends.",
				"settings:advanced.modelSize.standard.label": "Standard",
				"settings:advanced.modelSize.standard.description": "The full system prompt and every tool.",
				"settings:advanced.modelSize.slim.label": "Smaller models: slim toolset",
				"settings:advanced.modelSize.slim.description": "The full system prompt with fewer tools.",
				"settings:advanced.modelSize.slim.hideMcp.label": "Also hide MCP tools",
				"settings:advanced.modelSize.slim.hideMcp.description":
					"MCP tool schemas are usually the biggest part of the tool prompt.",
				"settings:advanced.modelSize.compact.label": "Very small models: compact mode",
				"settings:advanced.modelSize.compact.description": "A short system prompt and nine tools.",
			}
			return translations[key] || key
		},
	}),
}))

const radio = (label: string) => screen.getByRole("radio", { name: new RegExp(label) })

describe("modelSizeOf", () => {
	it("reads the stored flags, compact winning over slim like the tool filter", () => {
		expect(modelSizeOf({})).toBe("standard")
		expect(modelSizeOf({ slimToolset: false, compactProfile: false })).toBe("standard")
		expect(modelSizeOf({ slimToolset: true })).toBe("slim")
		expect(modelSizeOf({ compactProfile: true })).toBe("compact")
		expect(modelSizeOf({ slimToolset: true, compactProfile: true })).toBe("compact")
	})
})

describe("ModelSizeControl", () => {
	it("offers three options in one radio group, Standard selected for an untouched profile", () => {
		render(<ModelSizeControl onChange={vi.fn()} />)

		expect(screen.getByRole("radiogroup", { name: "Model size" })).toBeInTheDocument()
		expect(screen.getAllByRole("radio")).toHaveLength(3)
		expect(radio("Standard")).toBeChecked()
		expect(radio("Smaller models")).not.toBeChecked()
		expect(radio("Very small models")).not.toBeChecked()
		expect(screen.queryByText("Also hide MCP tools")).not.toBeInTheDocument()
	})

	it("selects slim by writing only slimToolset", () => {
		const onChange = vi.fn()
		render(<ModelSizeControl onChange={onChange} />)

		fireEvent.click(radio("Smaller models"))

		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith("slimToolset", true)
	})

	it("selects compact by writing only compactProfile", () => {
		const onChange = vi.fn()
		render(<ModelSizeControl onChange={onChange} />)

		fireEvent.click(radio("Very small models"))

		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith("compactProfile", true)
	})

	it("moves from slim to compact by turning slim off and compact on", () => {
		const onChange = vi.fn()
		render(<ModelSizeControl slimToolset={true} onChange={onChange} />)

		fireEvent.click(radio("Very small models"))

		expect(onChange).toHaveBeenCalledTimes(2)
		expect(onChange).toHaveBeenCalledWith("slimToolset", false)
		expect(onChange).toHaveBeenCalledWith("compactProfile", true)
	})

	it("goes back to Standard by clearing the flag that was on", () => {
		const onChange = vi.fn()
		render(<ModelSizeControl compactProfile={true} onChange={onChange} />)

		fireEvent.click(radio("Standard"))

		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith("compactProfile", false)
	})

	it("shows compact for a profile that carries both flags, and choosing slim clears compact only", () => {
		const onChange = vi.fn()
		render(<ModelSizeControl slimToolset={true} compactProfile={true} onChange={onChange} />)

		expect(radio("Very small models")).toBeChecked()

		fireEvent.click(radio("Smaller models"))

		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith("compactProfile", false)
	})

	it("reveals the MCP sub-control only for slim, checked when slimHidesMcp is unset", () => {
		const { rerender } = render(<ModelSizeControl slimToolset={true} onChange={vi.fn()} />)

		expect(screen.getByRole("checkbox")).toBeChecked()

		rerender(<ModelSizeControl compactProfile={true} onChange={vi.fn()} />)
		expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
	})

	it("writes slimHidesMcp from the MCP sub-control", () => {
		const onChange = vi.fn()
		render(<ModelSizeControl slimToolset={true} slimHidesMcp={false} onChange={onChange} />)

		const hideMcp = screen.getByRole("checkbox")
		expect(hideMcp).not.toBeChecked()

		fireEvent.click(hideMcp)
		expect(onChange).toHaveBeenCalledWith("slimHidesMcp", true)
	})
})
