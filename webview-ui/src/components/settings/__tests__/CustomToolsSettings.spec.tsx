import { act, render, screen } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import { CustomToolsSettings } from "../CustomToolsSettings"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const refreshes = () => vi.mocked(vscode.postMessage).mock.calls.filter(([m]) => m.type === "refreshCustomTools").length

describe("CustomToolsSettings", () => {
	beforeEach(() => vi.mocked(vscode.postMessage).mockClear())

	it("turning the tools back on asks for them again and drops the list from before", () => {
		const { rerender } = render(<CustomToolsSettings enabled={true} onChange={vi.fn()} />)
		expect(refreshes()).toBe(1)
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "customToolsResult",
						tools: [{ name: "alpha", description: "first", parameters: {} }],
					},
				}),
			)
		})
		expect(screen.getByText("alpha")).toBeInTheDocument()

		rerender(<CustomToolsSettings enabled={false} onChange={vi.fn()} />)
		rerender(<CustomToolsSettings enabled={true} onChange={vi.fn()} />)

		expect(refreshes()).toBe(2)
		expect(screen.queryByText("alpha")).not.toBeInTheDocument()
		expect(screen.getByText("settings:experimental.CUSTOM_TOOLS.noTools")).toBeInTheDocument()
	})
})
