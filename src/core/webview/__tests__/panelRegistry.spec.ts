// npx vitest run core/webview/__tests__/panelRegistry.spec.ts

import type * as vscode from "vscode"

import { clearPanels, getPanel, getSidebarPanel, getTabPanel, setPanel } from "../panelRegistry"

const sidebar = { kind: "sidebar" } as unknown as vscode.WebviewView
const tab = { kind: "tab" } as unknown as vscode.WebviewPanel

describe("panelRegistry", () => {
	beforeEach(() => {
		clearPanels()
	})

	it("starts empty", () => {
		expect(getPanel()).toBeUndefined()
		expect(getTabPanel()).toBeUndefined()
		expect(getSidebarPanel()).toBeUndefined()
	})

	it("stores a sidebar view and returns it as the active panel", () => {
		setPanel(sidebar, "sidebar")

		expect(getPanel()).toBe(sidebar)
		expect(getSidebarPanel()).toBe(sidebar)
		expect(getTabPanel()).toBeUndefined()
	})

	it("keeps one panel at a time: setting a tab clears the sidebar and the other way round", () => {
		setPanel(sidebar, "sidebar")
		setPanel(tab, "tab")

		expect(getPanel()).toBe(tab)
		expect(getTabPanel()).toBe(tab)
		expect(getSidebarPanel()).toBeUndefined()

		setPanel(sidebar, "sidebar")

		expect(getPanel()).toBe(sidebar)
		expect(getTabPanel()).toBeUndefined()
	})

	it("forgets a disposed tab when set to undefined", () => {
		setPanel(tab, "tab")
		setPanel(undefined, "tab")

		expect(getPanel()).toBeUndefined()
	})

	it("clearPanels drops both references", () => {
		setPanel(tab, "tab")
		clearPanels()

		expect(getPanel()).toBeUndefined()
	})
})
