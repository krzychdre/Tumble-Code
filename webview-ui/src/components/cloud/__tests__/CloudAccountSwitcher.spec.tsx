import { act, fireEvent, render, screen } from "@/utils/test-utils"

import type { CloudOrganizationMembership, CloudUserInfo } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

import { CloudAccountSwitcher } from "../CloudAccountSwitcher"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

// Radix Select does not open in jsdom, so a plain stand-in exposes each item as a button
// that calls the Select's onValueChange, and the Select's value and disabled flag as attributes.
vi.mock("@/components/ui/select", async () => {
	const React = await import("react")
	const SelectContext = React.createContext<(value: string) => void>(() => {})
	return {
		Select: ({ value, onValueChange, disabled, children }: any) => (
			<SelectContext.Provider value={onValueChange}>
				<div data-testid="select" data-value={value} data-disabled={disabled ? "true" : "false"}>
					{children}
				</div>
			</SelectContext.Provider>
		),
		SelectTrigger: ({ children, ...props }: any) => (
			<div data-testid="trigger" aria-label={props["aria-label"]}>
				{children}
			</div>
		),
		SelectValue: ({ children }: any) => <div>{children}</div>,
		SelectContent: ({ children }: any) => <div>{children}</div>,
		SelectSeparator: () => <hr />,
		SelectItem: ({ value, children }: any) => {
			const onValueChange = React.useContext(SelectContext)
			return (
				<button data-testid={`item-${value}`} onClick={() => onValueChange(value)}>
					{children}
				</button>
			)
		},
	}
})

const userInfo: CloudUserInfo = { name: "Ada", email: "ada@example.com" }
const organizations: CloudOrganizationMembership[] = [
	{ id: "m-1", role: "member", organization: { id: "org-1", name: "Acme", slug: "acme" } },
]

const mockState: Record<string, unknown> = {}
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockState,
}))

const postSwitchResult = (success: boolean, organizationId: string | null) =>
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", { data: { type: "organizationSwitchResult", success, organizationId } }),
		)
	})

describe("CloudAccountSwitcher", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		Object.assign(mockState, {
			cloudUserInfo: userInfo,
			cloudOrganizations: organizations,
			cloudApiUrl: "https://cloud.example.com",
		})
	})

	it("renders nothing when the user is not signed in", () => {
		mockState.cloudUserInfo = undefined
		const { container } = render(<CloudAccountSwitcher />)
		expect(container).toBeEmptyDOMElement()
	})

	it("asks the extension to switch and shows the new organization", () => {
		render(<CloudAccountSwitcher />)
		fireEvent.click(screen.getByTestId("item-org-1"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "switchOrganization", organizationId: "org-1" })
		expect(screen.getByTestId("trigger")).toHaveAttribute("aria-label", "Acme")
		expect(screen.getByTestId("select")).toHaveAttribute("data-disabled", "true")
	})

	it("keeps the new organization and unlocks after a successful switch", () => {
		render(<CloudAccountSwitcher />)
		fireEvent.click(screen.getByTestId("item-org-1"))
		postSwitchResult(true, "org-1")

		expect(screen.getByTestId("trigger")).toHaveAttribute("aria-label", "Acme")
		expect(screen.getByTestId("select")).toHaveAttribute("data-disabled", "false")
	})

	it("reverts to the previous account when the switch fails", () => {
		render(<CloudAccountSwitcher />)
		fireEvent.click(screen.getByTestId("item-org-1"))
		postSwitchResult(false, "org-1")

		expect(screen.getByTestId("select")).toHaveAttribute("data-value", "personal")
		expect(screen.getByTestId("trigger")).toHaveAttribute("aria-label", "cloud:personalAccount")
		expect(screen.getByTestId("select")).toHaveAttribute("data-disabled", "false")
	})

	it("opens the billing page for the create-team option", () => {
		mockState.cloudOrganizations = []
		render(<CloudAccountSwitcher />)
		fireEvent.click(screen.getByTestId("item-create-team"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: "https://cloud.example.com/billing",
		})
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "switchOrganization" }))
	})
})
