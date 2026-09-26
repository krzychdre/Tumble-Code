// Characterization of the real vscrui Checkbox through one of its 10 call sites
// (every other spec mocks "vscrui"). It pins what the settings forms rely on:
// the label/input/svg markup that index.css styles (.vscrui-checkbox svg), a
// checked state that follows the prop, and onChange called with a boolean.
// It also proves that the vscrui build we ship can be imported and rendered at
// all: vscrui 0.2/0.3 bundle React 18's jsx-runtime, which reads React 18
// internals at import time and throws under React 19.
import { fireEvent, render } from "@/utils/test-utils"

import { R1FormatSetting } from "../R1FormatSetting"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

describe("R1FormatSetting with the real vscrui Checkbox", () => {
	it("renders the vscrui label, hidden input, check svg and label text", () => {
		const { container } = render(<R1FormatSetting onChange={vi.fn()} openAiR1FormatEnabled={true} />)

		const label = container.querySelector("label.vscrui-checkbox")
		expect(label).not.toBeNull()

		const input = label!.querySelector("input[type='checkbox']") as HTMLInputElement
		expect(input).not.toBeNull()
		expect(label!.getAttribute("for")).toBe(input.id)
		expect(input.checked).toBe(true)

		const svg = label!.querySelector("svg")
		expect(svg?.getAttribute("fill")).toBe("currentColor")
		expect(label!.querySelector(".vscrui-checkbox__label")?.textContent).toBe("settings:modelInfo.enableR1Format")
	})

	it("follows the checked prop and reports clicks as a boolean", () => {
		const onChange = vi.fn()
		const { container, rerender } = render(<R1FormatSetting onChange={onChange} openAiR1FormatEnabled={false} />)
		const input = container.querySelector("input[type='checkbox']") as HTMLInputElement
		expect(input.checked).toBe(false)
		expect(container.querySelector("svg")?.getAttribute("fill")).toBe("transparent")

		fireEvent.click(input)
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith(true)

		rerender(<R1FormatSetting onChange={onChange} openAiR1FormatEnabled={false} />)
		rerender(<R1FormatSetting onChange={onChange} openAiR1FormatEnabled={true} />)
		expect(input.checked).toBe(true)
	})
})
