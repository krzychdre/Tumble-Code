// Regression: switching to a profile without a custom temperature must not
// store an empty (null) temperature.
//
// TemperatureControl syncs its checkbox from the `value` prop when the profile
// changes. The deprecated toolkit checkbox fired onChange for that prop change
// as if the user had unticked it, so the control reported null (the "unset"
// value used for a deliberate untick) instead of leaving the profile's
// temperature undefined. The toolkit is deliberately not mocked.

import { act, render } from "@/utils/test-utils"

import { TemperatureControl } from "../TemperatureControl"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

describe("TemperatureControl profile switch", () => {
	it("reports undefined, never null, when the new profile has no custom temperature", async () => {
		const onChange = vi.fn()
		const { rerender } = render(<TemperatureControl value={0.7} onChange={onChange} />)
		await wait(100)
		onChange.mockClear()

		rerender(<TemperatureControl value={undefined} onChange={onChange} />)
		// Longer than the 50 ms debounce.
		await wait(200)

		expect(onChange).not.toHaveBeenCalledWith(null)
	})
})
