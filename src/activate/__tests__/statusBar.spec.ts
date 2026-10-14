import * as vscode from "vscode"

import { registerStatusBarItem, STATUS_BAR_CLICK_SOURCE } from "../statusBar"

vi.mock("vscode", () => ({
	StatusBarAlignment: { Left: 1, Right: 2 },
	window: {
		createStatusBarItem: vi.fn(() => ({ show: vi.fn(), dispose: vi.fn() })),
	},
}))

vi.mock("../../i18n", () => ({
	t: (key: string) => `translated:${key}`,
}))

describe("registerStatusBarItem", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const register = () => {
		const context = { subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext
		const item = registerStatusBarItem(context)
		return { context, item }
	}

	it("creates a named, right-aligned item with a stable id", () => {
		const { item } = register()

		expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
			"tumble-code.openTab",
			vscode.StatusBarAlignment.Right,
			100,
		)
		// The name is what VS Code shows in the status bar's context menu, where the user can hide the item.
		expect(item.name).toBe("Tumble Code")
		expect(item.text).toBe("$(sparkle) Tumble Code")
		expect(item.tooltip).toBe("translated:common:statusBar.openTab")
	})

	it("runs the open-in-new-tab command with the status bar as the source", () => {
		const { item } = register()

		expect(item.command).toEqual({
			title: "translated:common:statusBar.openTab",
			command: "tumble-code.openInNewTab",
			arguments: [STATUS_BAR_CLICK_SOURCE],
		})
	})

	it("shows the item and disposes it with the extension", () => {
		const { context, item } = register()

		expect(item.show).toHaveBeenCalledTimes(1)
		expect(context.subscriptions).toContain(item)
	})
})
