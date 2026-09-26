// Since the last DEP-9 step the toolkit is no longer installed: these specs
// now run on the replacement components and keep pinning the behaviour the
// toolkit had (the toolkit-only branches in the helpers are unused).

// Characterization of the webview's VSCodePanels / VSCodePanelTab /
// VSCodePanelView call site (refactor DEP-9: the deprecated toolkit tabs are
// being replaced). The only user is the expanded MCP server row in McpView.
// The toolkit is NOT mocked: its tabs and panels are light-DOM elements with
// role="tab" / role="tabpanel" (the tablist itself lives in a shadow root),
// so the assertions go through those roles and hold for the replacement too.

import { fireEvent, render, screen, waitFor, within } from "@/utils/test-utils"

import McpView from "@src/components/mcp/McpView"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("react-i18next", async () => {
	const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next")
	return { ...actual, Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span> }
})

const server = {
	name: "github",
	config: "{}",
	status: "connected",
	source: "global",
	tools: [
		{ name: "search_code", description: "d", enabledForPrompt: true },
		{ name: "open_issue", description: "d", enabledForPrompt: true },
	],
	resources: [],
	resourceTemplates: [],
	errorHistory: [{ message: "boom", timestamp: 1, level: "error" }],
	instructions: undefined as string | undefined,
}

let servers = [server]
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ mcpServers: servers, alwaysAllowMcp: false, mcpEnabled: true }),
}))

const expand = async () => {
	render(<McpView />)
	fireEvent.click(screen.getByText("github"))
	await waitFor(() => expect(screen.getAllByRole("tab").length).toBeGreaterThan(0))
}

const selected = () => screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-selected"))
const visiblePanels = () => screen.getAllByRole("tabpanel", { hidden: true }).filter((p) => !p.hasAttribute("hidden"))

describe("VSCodePanels call site: McpView server row", () => {
	beforeEach(() => {
		servers = [{ ...server }]
	})

	it("shows Tools, Resources and Logs tabs with counts, Tools selected and its panel alone visible", async () => {
		await expand()

		expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.replace(/\s+/g, " ").trim())).toEqual([
			"mcp:tabs.tools (2)",
			"mcp:tabs.resources (0)",
			"mcp:tabs.logs (1)",
		])
		await waitFor(() => expect(selected()).toEqual(["true", "false", "false"]))
		expect(visiblePanels()).toHaveLength(1)
		expect(within(visiblePanels()[0]).getByText("search_code")).toBeInTheDocument()

		// Tabs and panels are linked for assistive technology.
		const [toolsTab] = screen.getAllByRole("tab")
		expect(toolsTab.getAttribute("aria-controls")).toBe(visiblePanels()[0].id)
		expect(visiblePanels()[0].getAttribute("aria-labelledby")).toBe(toolsTab.id)
	})

	it("clicking a tab selects it and shows its panel only", async () => {
		await expand()

		fireEvent.click(screen.getAllByRole("tab")[2])

		await waitFor(() => expect(selected()).toEqual(["false", "false", "true"]))
		expect(visiblePanels()).toHaveLength(1)
		expect(within(visiblePanels()[0]).getByText("boom")).toBeInTheDocument()
	})

	it("arrow keys move the selection (wrapping), and only the selected tab is in the tab order", async () => {
		await expand()
		await waitFor(() => expect(selected()).toEqual(["true", "false", "false"]))

		fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ArrowRight" })
		await waitFor(() => expect(selected()).toEqual(["false", "true", "false"]))

		fireEvent.keyDown(screen.getAllByRole("tab")[1], { key: "ArrowLeft" })
		fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ArrowLeft" })
		await waitFor(() => expect(selected()).toEqual(["false", "false", "true"]))

		expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"])
	})

	it("adds an Instructions tab before Logs when the server has instructions", async () => {
		servers = [{ ...server, instructions: "Use carefully." }]
		await expand()

		expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.replace(/\s+/g, " ").trim())).toEqual([
			"mcp:tabs.tools (2)",
			"mcp:tabs.resources (0)",
			"mcp:instructions",
			"mcp:tabs.logs (1)",
		])
		fireEvent.click(screen.getAllByRole("tab")[2])
		await waitFor(() => expect(within(visiblePanels()[0]).getByText("Use carefully.")).toBeInTheDocument())
	})
})
