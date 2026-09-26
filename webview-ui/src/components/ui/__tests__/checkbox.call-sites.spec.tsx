// Characterization of what users rely on at the webview's checkbox call sites
// (refactor DEP-9: the deprecated `VSCodeCheckbox` from
// @vscode/webview-ui-toolkit is being replaced by a native checkbox).
//
// The toolkit is NOT mocked here. In jsdom it renders a `<vscode-checkbox>`
// custom element that itself carries role="checkbox", `checked`, the tab stop
// and the call site's data-testid. The replacement puts those on a native
// `<input type="checkbox">` inside a `<label>`. The assertions below go through
// the accessible role, the `checked` property, clicks and test ids, so they
// hold for both shapes.

import userEvent from "@testing-library/user-event"

import { fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import { ExperimentalFeature } from "@src/components/settings/ExperimentalFeature"
import { MemorySettings } from "@src/components/settings/MemorySettings"
import McpToolRow from "@src/components/mcp/McpToolRow"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

type CheckableElement = HTMLElement & { checked: boolean }

describe("checkbox call sites (VSCodeCheckbox replacement characterization)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("ExperimentalFeature: a labelled, keyboard-focusable checkbox that reports the new state", async () => {
		const onChange = vi.fn()
		render(<ExperimentalFeature experimentKey="DEMO" enabled={false} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox", { name: "settings:experimental.DEMO.name" }) as CheckableElement
		expect(checkbox.checked).toBe(false)
		expect(checkbox.tabIndex).toBe(0)

		fireEvent.click(checkbox)

		await waitFor(() => expect(onChange).toHaveBeenCalledWith(true))
	})

	it("ExperimentalFeature: clicking the label text toggles too, and a checked box reports false", async () => {
		const onChange = vi.fn()
		render(<ExperimentalFeature experimentKey="DEMO" enabled={true} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox", { name: "settings:experimental.DEMO.name" }) as CheckableElement
		await waitFor(() => expect(checkbox.checked).toBe(true))

		fireEvent.click(screen.getByText("settings:experimental.DEMO.name"))

		await waitFor(() => expect(onChange).toHaveBeenCalledWith(false))
	})

	it("MemorySettings: data-testid reaches the checkbox; a disabled one ignores clicks", async () => {
		const setCachedStateField = vi.fn()
		const { rerender } = render(
			<MemorySettings
				autoMemoryEnabled={true}
				autoMemoryShareWithClaudeCode={false}
				listApiConfigMeta={[]}
				setCachedStateField={setCachedStateField}
			/>,
		)

		const checkbox = screen.getByTestId("memory-share-claude-code-checkbox") as CheckableElement
		expect(checkbox.checked).toBe(false)

		fireEvent.click(checkbox)
		await waitFor(() => expect(setCachedStateField).toHaveBeenCalledWith("autoMemoryShareWithClaudeCode", true))

		// A custom memory directory disables the "share with Claude Code" option.
		rerender(
			<MemorySettings
				autoMemoryEnabled={true}
				autoMemoryDirectory="/tmp/memory"
				autoMemoryShareWithClaudeCode={false}
				listApiConfigMeta={[]}
				setCachedStateField={setCachedStateField}
			/>,
		)
		const disabled = screen.getByTestId("memory-share-claude-code-checkbox") as CheckableElement
		await waitFor(() => expect(disabled).toBeDisabled())
		setCachedStateField.mockClear()

		// user-event, like a browser, does not activate a disabled control
		// (jsdom's fireEvent would toggle even a disabled native checkbox).
		await userEvent.click(disabled)

		expect(setCachedStateField).not.toHaveBeenCalledWith("autoMemoryShareWithClaudeCode", expect.anything())
	})

	it("McpToolRow: the always-allow checkbox keeps its className and posts the toggle", async () => {
		render(
			<McpToolRow
				tool={{ name: "search", description: "d", alwaysAllow: false, enabledForPrompt: true } as never}
				serverName="srv"
				serverSource="global"
				alwaysAllowMcp
			/>,
		)

		const checkbox = screen.getByRole("checkbox", { name: "mcp:tool.alwaysAllow" }) as CheckableElement
		// The call site's className lands on the element that wraps box and label.
		expect(checkbox.closest(".text-xs")).not.toBeNull()

		fireEvent.click(checkbox)

		await waitFor(() =>
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "toggleToolAlwaysAllow",
				serverName: "srv",
				source: "global",
				toolName: "search",
				alwaysAllow: true,
			}),
		)
	})
})
