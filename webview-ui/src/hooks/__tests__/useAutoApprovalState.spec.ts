import { renderHook } from "@testing-library/react"

import { SETTINGS_DEFAULTS } from "@tumble-code/types"

import { useAutoApprovalState } from "../useAutoApprovalState"

describe("useAutoApprovalState", () => {
	it.each([
		{ name: "no toggles", toggles: {}, expected: false },
		{
			name: "all off or unset",
			toggles: { alwaysAllowReadOnly: false, alwaysAllowWrite: undefined },
			expected: false,
		},
		{ name: "one on", toggles: { alwaysAllowWrite: false, alwaysApprovePlan: true }, expected: true },
	])("hasEnabledOptions with $name: $expected", ({ toggles, expected }) => {
		expect(renderHook(() => useAutoApprovalState(toggles, true)).result.current.hasEnabledOptions).toBe(expected)
	})

	it.each([
		{ enabled: true, expected: true },
		{ enabled: false, expected: false },
		{ enabled: undefined, expected: SETTINGS_DEFAULTS.autoApprovalEnabled },
	])("effectiveAutoApprovalEnabled for $enabled is $expected, whatever the toggles", ({ enabled, expected }) => {
		const { result } = renderHook(() => useAutoApprovalState({ alwaysAllowReadOnly: true }, enabled))

		expect(result.current.effectiveAutoApprovalEnabled).toBe(expected)
	})

	it("follows a toggle change", () => {
		const { result, rerender } = renderHook(({ toggles }) => useAutoApprovalState(toggles, true), {
			initialProps: { toggles: { alwaysAllowReadOnly: false } },
		})

		rerender({ toggles: { alwaysAllowReadOnly: true } })

		expect(result.current.hasEnabledOptions).toBe(true)
	})
})
