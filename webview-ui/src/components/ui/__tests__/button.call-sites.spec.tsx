// Since the last DEP-9 step the toolkit is no longer installed: these specs
// now run on the replacement components and keep pinning the behaviour the
// toolkit had (the toolkit-only branches in the helpers are unused).

// Characterization of what users rely on at the webview's VSCodeButton call
// sites (refactor DEP-9: the deprecated `VSCodeButton` from
// @vscode/webview-ui-toolkit is being replaced by a native button).
//
// The toolkit is NOT mocked here. In jsdom it renders a `<vscode-button>`
// custom element that carries the call site's props and click handler, while
// the real `<button>` lives in its shadow root. `buttonParts` resolves both
// shapes, so the same assertions hold before and after the swap.

import React from "react"

import { fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import { TerminalSettings } from "@src/components/settings/TerminalSettings"
import { ErrorRow } from "@src/components/chat/ErrorRow"
import { Markdown } from "@src/components/chat/Markdown"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("react-i18next", async () => {
	const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next")
	return { ...actual, useTranslation: () => ({ t: (key: string) => key }) }
})

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ version: "1.0.0", apiConfiguration: {} }),
}))

vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({ provider: "test-provider", id: "test-model" }),
}))

const copyWithFeedback = vi.fn(async (_text: string) => true)
vi.mock("@src/utils/clipboard", () => ({
	useCopyToClipboard: () => ({ showCopyFeedback: false, copyWithFeedback }),
}))

/**
 * `host` receives the call site's props and click handler; `control` is the
 * `<button>` the browser focuses and activates.
 */
async function buttonParts(start: Element) {
	const host = start.closest("button, vscode-button") as HTMLElement | null
	expect(host).not.toBeNull()
	const resolveControl = () =>
		host!.tagName === "BUTTON" ? (host as HTMLButtonElement) : host!.shadowRoot?.querySelector("button")
	await waitFor(() => expect(resolveControl()).toBeTruthy())
	return { host: host!, control: resolveControl()! }
}

describe("VSCodeButton call sites (replacement characterization)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("TerminalSettings: the Configure button is a keyboard-focusable button that opens the profile picker", async () => {
		const onTerminalProfilePickerOpened = vi.fn()
		render(
			<TerminalSettings
				terminalShellIntegrationDisabled={false}
				onTerminalProfilePickerOpened={onTerminalProfilePickerOpened}
				setCachedStateField={vi.fn()}
			/>,
		)

		const { host, control } = await buttonParts(screen.getByTestId("terminal-profile-configure-button"))
		expect(control.tagName).toBe("BUTTON")
		expect(control.tabIndex).toBe(0)
		expect(host).toHaveTextContent("settings:terminal.profile.configureButton")

		fireEvent.click(host)

		expect(onTerminalProfilePickerOpened).toHaveBeenCalledTimes(1)
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "openTerminalProfilePicker" })
	})

	it("ErrorRow: the copy icon button copies the message without toggling the row", async () => {
		const { container } = render(<ErrorRow type="diff_error" message="the diff failed" expandable showCopyButton />)

		const icon = container.querySelector(".codicon-copy")!
		const { host } = await buttonParts(icon)

		fireEvent.click(host)

		await waitFor(() => expect(copyWithFeedback).toHaveBeenCalledWith("the diff failed"))
		// The click stops at the button: the row did not expand...
		expect(container.querySelector(".codicon-chevron-down")).not.toBeNull()
		// ...while a click on the header itself does.
		fireEvent.click(icon.closest(".cursor-pointer")!)
		await waitFor(() => expect(container.querySelector(".codicon-chevron-up")).not.toBeNull())
	})

	it("Markdown: the copy button appears on hover and copies the markdown", async () => {
		const { container } = render(<Markdown markdown="**hello**" />)

		fireEvent.mouseEnter(container.firstElementChild!)
		const icon = await waitFor(() => {
			const el = container.querySelector(".codicon-copy")
			expect(el).not.toBeNull()
			return el!
		})
		const { host } = await buttonParts(icon)

		fireEvent.click(host)

		await waitFor(() => expect(copyWithFeedback).toHaveBeenCalledWith("**hello**"))
	})
})
