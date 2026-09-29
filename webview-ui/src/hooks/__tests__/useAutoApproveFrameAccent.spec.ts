import { renderHook } from "@testing-library/react"

import { isElevatedAutoApproval, useAutoApproveFrameAccent } from "../useAutoApproveFrameAccent"

let state: { autoApprovalEnabled?: boolean; autoApprovalMode?: string } = {}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionSelector: (selector: (s: typeof state) => unknown) => selector(state),
}))

describe("isElevatedAutoApproval", () => {
	it.each([
		[true, "bypass", true],
		[true, "autonomous", true],
		[true, "default", false],
		[true, undefined, false],
		[false, "bypass", false],
		[undefined, "autonomous", false],
	] as const)("enabled=%s mode=%s -> %s", (enabled, mode, expected) => {
		expect(isElevatedAutoApproval(enabled, mode)).toBe(expected)
	})
})

describe("useAutoApproveFrameAccent", () => {
	afterEach(() => {
		delete document.documentElement.dataset.autoApprove
	})

	it("marks the root while bypass is on and clears it when switched back", () => {
		state = { autoApprovalEnabled: true, autoApprovalMode: "bypass" }
		const { rerender } = renderHook(() => useAutoApproveFrameAccent())
		expect(document.documentElement.dataset.autoApprove).toBe("elevated")

		state = { autoApprovalEnabled: true, autoApprovalMode: "default" }
		rerender()
		expect(document.documentElement.dataset.autoApprove).toBeUndefined()
	})

	it("ignores the mode while auto-approval is off", () => {
		state = { autoApprovalEnabled: false, autoApprovalMode: "autonomous" }
		renderHook(() => useAutoApproveFrameAccent())
		expect(document.documentElement.dataset.autoApprove).toBeUndefined()
	})
})
