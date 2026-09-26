// Characterization of the in-repo VSCRUICheckbox (the vscrui replacement)
// through one of its 10 call sites (every other spec mocks it). It pins what
// the settings forms rely on: the label/input/svg markup that index.css styles
// (.ui-checkbox), a checked state that follows the prop, and onChange called
// with a boolean.
import { fireEvent, render } from "@/utils/test-utils"

import { R1FormatSetting } from "../R1FormatSetting"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

describe("R1FormatSetting with the real VSCRUICheckbox", () => {
	it("renders the label, hidden input, check svg and label text", () => {
		const { container } = render(<R1FormatSetting onChange={vi.fn()} openAiR1FormatEnabled={true} />)

		const label = container.querySelector("label.ui-checkbox")
		expect(label).not.toBeNull()

		const input = label!.querySelector("input[type='checkbox']") as HTMLInputElement
		expect(input).not.toBeNull()
		expect(label!.contains(input)).toBe(true)
		expect(input.checked).toBe(true)

		const svg = label!.querySelector("svg.ui-checkbox-check")
		expect(svg?.getAttribute("fill")).toBe("currentColor")
		expect(label!.querySelector(".ui-checkbox-label")?.textContent).toBe("settings:modelInfo.enableR1Format")
	})

	it("follows the checked prop and reports clicks as a boolean", () => {
		const onChange = vi.fn()
		const { container, rerender } = render(<R1FormatSetting onChange={onChange} openAiR1FormatEnabled={false} />)
		const input = container.querySelector("input[type='checkbox']") as HTMLInputElement
		expect(input.checked).toBe(false)

		fireEvent.click(input)
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith(true)

		rerender(<R1FormatSetting onChange={onChange} openAiR1FormatEnabled={false} />)
		rerender(<R1FormatSetting onChange={onChange} openAiR1FormatEnabled={true} />)
		expect(input.checked).toBe(true)
	})
})
