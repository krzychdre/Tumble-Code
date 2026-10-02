import type { McpServer } from "@tumble-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"
import { vscode } from "@src/utils/vscode"

import { ServerRow } from "../ServerRow"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
	}),
}))

// Radix Select needs pointer events and portals that jsdom lacks, so the shared
// Select becomes a native <select> here (the same stub UISettings.spec.tsx uses).
vi.mock("@src/components/ui", async (importOriginal) => ({
	...(await importOriginal<typeof import("@src/components/ui")>()),
	Select: ({ children, value, onValueChange }: any) => (
		<select value={value} onChange={(e) => onValueChange?.(e.target.value)}>
			{children}
		</select>
	),
	SelectTrigger: ({ children }: any) => <>{children}</>,
	SelectValue: () => null,
	SelectContent: ({ children }: any) => <>{children}</>,
	SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
}))

const server = (overrides: Partial<McpServer> = {}): McpServer =>
	({
		name: "github",
		config: JSON.stringify({ timeout: 30 }),
		status: "connected",
		source: "project",
		tools: [],
		resources: [],
		resourceTemplates: [],
		errorHistory: [],
		...overrides,
	}) as McpServer

const posted = () => vi.mocked(vscode.postMessage).mock.calls.map(([message]) => message)

describe("ServerRow", () => {
	beforeEach(() => vi.mocked(vscode.postMessage).mockClear())

	it("a connected server expands on a click and shows the stored network timeout", () => {
		render(<ServerRow server={server()} />)
		expect(screen.queryByRole("tab")).toBeNull()

		fireEvent.click(screen.getByText("github"))

		expect(screen.getAllByRole("tab").length).toBeGreaterThan(0)
		expect(screen.getByRole("combobox")).toHaveValue("30")
		fireEvent.change(screen.getByRole("combobox"), { target: { value: "300" } })
		expect(posted()).toContainEqual({
			type: "updateMcpTimeout",
			serverName: "github",
			source: "project",
			timeout: 300,
		})
	})

	it("the enable switch has a translated accessible name and posts the toggle", () => {
		render(<ServerRow server={server()} />)

		fireEvent.click(screen.getByRole("switch", { name: 'mcp:serverStatus.toggle {"serverName":"github"}' }))
		expect(posted()).toContainEqual({
			type: "toggleMcpServer",
			serverName: "github",
			source: "project",
			disabled: true,
		})
	})

	it("the status dot follows the connection state, grey when disabled", () => {
		const { rerender } = render(<ServerRow server={server()} />)
		expect(screen.getByTestId("mcp-server-status")).toHaveClass("bg-[var(--status-done)]")

		rerender(<ServerRow server={server({ status: "connecting" })} />)
		expect(screen.getByTestId("mcp-server-status")).toHaveClass("bg-[var(--status-waiting)]")

		rerender(<ServerRow server={server({ status: "disconnected" })} />)
		expect(screen.getByTestId("mcp-server-status")).toHaveClass("bg-[var(--status-failed)]")

		rerender(<ServerRow server={server({ disabled: true })} />)
		expect(screen.getByTestId("mcp-server-status")).toHaveClass("bg-vscode-descriptionForeground")
	})

	it("the icon buttons restart the server and ask before deleting it, without expanding the row", () => {
		render(<ServerRow server={server()} />)

		fireEvent.click(screen.getByRole("button", { name: "mcp:serverStatus.restart" }))
		expect(posted()).toContainEqual({ type: "restartMcpServer", text: "github", source: "project" })

		fireEvent.click(screen.getByRole("button", { name: "mcp:deleteDialog.title" }))
		expect(screen.queryByRole("tab")).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "mcp:deleteDialog.delete" }))
		expect(posted()).toContainEqual({ type: "deleteMcpServer", serverName: "github", source: "project" })
	})

	it("a disconnected server shows its error and a retry button instead of expanding", () => {
		render(<ServerRow server={server({ status: "disconnected", error: "spawn failed\nexit 1" })} />)

		fireEvent.click(screen.getByText("github"))
		expect(screen.queryByRole("tab")).toBeNull()
		expect(screen.getByText(/spawn failed/)).toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: "mcp:serverStatus.retryConnection" }))
		expect(posted()).toContainEqual({ type: "restartMcpServer", text: "github", source: "project" })
	})
})
