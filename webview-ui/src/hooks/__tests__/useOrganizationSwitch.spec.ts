import { act, renderHook } from "@testing-library/react"

import { vscode } from "@src/utils/vscode"

import { useOrganizationSwitch } from "../useOrganizationSwitch"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

const postSwitchResult = (data: Record<string, unknown>) =>
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: { type: "organizationSwitchResult", ...data } }))
	})

describe("useOrganizationSwitch", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("starts on the signed-in organization, or on the personal account when there is none", () => {
		expect(renderHook(() => useOrganizationSwitch({ organizationId: "org-1" })).result.current.selectedOrgId).toBe(
			"org-1",
		)
		expect(renderHook(() => useOrganizationSwitch({})).result.current.selectedOrgId).toBeNull()
	})

	it("follows the organization reported by the extension state", () => {
		const { result, rerender } = renderHook((props: { organizationId?: string }) => useOrganizationSwitch(props), {
			initialProps: { organizationId: undefined } as { organizationId?: string },
		})
		rerender({ organizationId: "org-2" })

		expect(result.current.selectedOrgId).toBe("org-2")
	})

	it("switches optimistically, locks until the result arrives and notifies the caller", () => {
		const onOrganizationChange = vi.fn()
		const { result } = renderHook(() => useOrganizationSwitch({ onOrganizationChange }))

		act(() => result.current.handleOrganizationChange("org-1"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "switchOrganization", organizationId: "org-1" })
		expect(onOrganizationChange).toHaveBeenCalledWith("org-1")
		expect(result.current.selectedOrgId).toBe("org-1")
		expect(result.current.isLoading).toBe(true)

		postSwitchResult({ success: true, organizationId: "org-1" })

		expect(result.current.selectedOrgId).toBe("org-1")
		expect(result.current.isLoading).toBe(false)
	})

	it("maps the personal option to a null organization", () => {
		const { result } = renderHook(() => useOrganizationSwitch({ organizationId: "org-1" }))

		act(() => result.current.handleOrganizationChange("personal"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "switchOrganization", organizationId: null })
		expect(result.current.selectedOrgId).toBeNull()
	})

	it("reverts to the signed-in organization when the switch fails", () => {
		const { result } = renderHook(() => useOrganizationSwitch({ organizationId: "org-1" }))

		act(() => result.current.handleOrganizationChange("org-2"))
		postSwitchResult({ success: false, organizationId: "org-2", error: "boom" })

		expect(result.current.selectedOrgId).toBe("org-1")
		expect(result.current.isLoading).toBe(false)
	})

	it("ignores picking the organization that is already selected", () => {
		const onOrganizationChange = vi.fn()
		const { result } = renderHook(() => useOrganizationSwitch({ organizationId: "org-1", onOrganizationChange }))

		act(() => result.current.handleOrganizationChange("org-1"))

		expect(vscode.postMessage).not.toHaveBeenCalled()
		expect(onOrganizationChange).not.toHaveBeenCalled()
		expect(result.current.isLoading).toBe(false)
	})

	it("opens the billing page for create-team, and does nothing without a cloud URL", () => {
		const withUrl = renderHook(() => useOrganizationSwitch({ cloudApiUrl: "https://cloud.example.com" }))
		act(() => withUrl.result.current.handleOrganizationChange("create-team"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: "https://cloud.example.com/billing",
		})
		expect(withUrl.result.current.selectedOrgId).toBeNull()

		vi.mocked(vscode.postMessage).mockClear()
		const withoutUrl = renderHook(() => useOrganizationSwitch({}))
		act(() => withoutUrl.result.current.handleOrganizationChange("create-team"))

		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("stops listening for results after unmount", () => {
		const removeSpy = vi.spyOn(window, "removeEventListener")
		const { unmount } = renderHook(() => useOrganizationSwitch({}))
		unmount()

		expect(removeSpy).toHaveBeenCalledWith("message", expect.any(Function))
		removeSpy.mockRestore()
	})
})
