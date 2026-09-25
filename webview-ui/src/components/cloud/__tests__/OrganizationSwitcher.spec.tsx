import { act, fireEvent, render, screen } from "@/utils/test-utils"

import type { CloudOrganizationMembership, CloudUserInfo } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

import { OrganizationSwitcher } from "../OrganizationSwitcher"

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

const postSwitchResult = (success: boolean, organizationId: string | null) =>
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", { data: { type: "organizationSwitchResult", success, organizationId } }),
		)
	})

describe("OrganizationSwitcher", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("asks the extension to switch, locks the picker and notifies the caller", () => {
		const onOrganizationChange = vi.fn()
		render(
			<OrganizationSwitcher
				userInfo={userInfo}
				organizations={organizations}
				onOrganizationChange={onOrganizationChange}
			/>,
		)
		fireEvent.click(screen.getByTestId("item-org-1"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "switchOrganization", organizationId: "org-1" })
		expect(onOrganizationChange).toHaveBeenCalledWith("org-1")
		expect(screen.getByTestId("select")).toHaveAttribute("data-value", "org-1")
		expect(screen.getByTestId("select")).toHaveAttribute("data-disabled", "true")
	})

	it("does nothing when the current account is picked again", () => {
		render(<OrganizationSwitcher userInfo={userInfo} organizations={organizations} />)
		fireEvent.click(screen.getByTestId("item-personal"))

		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("reverts to the previous account and unlocks when the switch fails", () => {
		render(<OrganizationSwitcher userInfo={userInfo} organizations={organizations} />)
		fireEvent.click(screen.getByTestId("item-org-1"))
		postSwitchResult(false, "org-1")

		expect(screen.getByTestId("select")).toHaveAttribute("data-value", "personal")
		expect(screen.getByTestId("select")).toHaveAttribute("data-disabled", "false")
	})

	it("opens the billing page for the create-team option", () => {
		render(<OrganizationSwitcher userInfo={userInfo} organizations={[]} cloudApiUrl="https://cloud.example.com" />)
		fireEvent.click(screen.getByTestId("item-create-team"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: "https://cloud.example.com/billing",
		})
	})
})
