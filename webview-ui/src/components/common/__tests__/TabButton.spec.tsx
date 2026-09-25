import { render, screen } from "@/utils/test-utils"

import { TabButton } from "../TabButton"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

describe("TabButton", () => {
	it("colors the active tab's icon with a theme class, not an inline style", () => {
		render(<TabButton icon="code" label="Code" isActive={true} onClick={() => {}} />)

		const icon = screen.getByRole("button").querySelector(".codicon")!
		expect(icon).toHaveClass("codicon-code", "text-vscode-focusBorder")
		expect(icon.getAttribute("style")).toBeNull()
	})

	it("leaves an inactive tab's icon uncolored", () => {
		render(<TabButton icon="code" label="Code" isActive={false} onClick={() => {}} />)

		const icon = screen.getByRole("button").querySelector(".codicon")!
		expect(icon).not.toHaveClass("text-vscode-focusBorder")
	})
})
