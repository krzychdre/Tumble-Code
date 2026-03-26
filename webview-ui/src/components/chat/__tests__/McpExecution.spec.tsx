// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/McpExecution.spec.tsx

import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"

import { McpExecution } from "../McpExecution"

vi.mock("react-use", () => ({
	useEvent: vi.fn(),
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, fallback?: string) => {
			const translations: Record<string, string> = {
				"execution.running": "Running",
				"execution.completed": "Completed",
				"execution.error": "Error",
				"execution.response": "Response",
			}
			return translations[key] || fallback || key
		},
	}),
}))

vi.mock("../../common/CodeBlock", () => ({
	default: ({ source }: { source: string }) => <div data-testid="code-block">{source}</div>,
}))

vi.mock("../../mcp/McpToolRow", () => ({
	default: ({ tool, serverName }: { tool: { name: string; description: string }; serverName: string }) => (
		<div data-testid="mcp-tool-row">
			<span data-testid="mcp-tool-row-name">{tool.name}</span>
			<span data-testid="mcp-tool-row-description">{tool.description}</span>
			<span data-testid="mcp-tool-row-server">{serverName}</span>
		</div>
	),
}))

vi.mock("../Markdown", () => ({
	Markdown: ({ markdown }: { markdown: string }) => <div data-testid="markdown">{markdown}</div>,
}))

describe("McpExecution", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("concise header display", () => {
		it("renders server name and tool name in the concise header", () => {
			render(<McpExecution executionId="test-1" serverName="context7" toolName="query-docs" />)

			expect(screen.getByTestId("mcp-server-name")).toHaveTextContent("context7")
			expect(screen.getByTestId("mcp-tool-name")).toHaveTextContent("query-docs")
		})

		it("renders server name from useMcpServer when provided", () => {
			render(
				<McpExecution
					executionId="test-1"
					useMcpServer={{
						type: "use_mcp_tool",
						serverName: "my-server",
						toolName: "my-tool",
						arguments: "{}",
					}}
				/>,
			)

			expect(screen.getByTestId("mcp-server-name")).toHaveTextContent("my-server")
			expect(screen.getByTestId("mcp-tool-name")).toHaveTextContent("my-tool")
		})

		it("renders only server name when tool name is not provided", () => {
			render(<McpExecution executionId="test-1" serverName="context7" />)

			expect(screen.getByTestId("mcp-server-name")).toHaveTextContent("context7")
			expect(screen.queryByTestId("mcp-tool-name")).not.toBeInTheDocument()
		})

		it("renders ChevronRight icon between server and tool names", () => {
			render(<McpExecution executionId="test-1" serverName="context7" toolName="query-docs" />)

			// The ChevronRight icon should be present when both server and tool names are shown
			// Lucide icons have class "lucide-chevron-right" (singular)
			const header = screen.getByTestId("mcp-execution-header")
			const chevronRight = header.querySelector(".lucide-chevron-right")
			expect(chevronRight).toBeInTheDocument()
		})

		it("does not render ChevronRight when only server name is present", () => {
			render(<McpExecution executionId="test-1" serverName="context7" />)

			const header = screen.getByTestId("mcp-execution-header")
			const chevronRight = header.querySelector(".lucide-chevron-right")
			expect(chevronRight).not.toBeInTheDocument()
		})
	})

	describe("details collapse/expand behavior", () => {
		it("does not show details content by default", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					text='{"query": "react hooks"}'
					isArguments={true}
				/>,
			)

			expect(screen.queryByTestId("mcp-details-content")).not.toBeInTheDocument()
		})

		it("shows details content after clicking the header", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					text='{"query": "react hooks"}'
					isArguments={true}
				/>,
			)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			expect(screen.getByTestId("mcp-details-content")).toBeInTheDocument()
		})

		it("hides details content after clicking the header twice", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					text='{"query": "react hooks"}'
					isArguments={true}
				/>,
			)

			const header = screen.getByTestId("mcp-execution-header")
			fireEvent.click(header)
			expect(screen.getByTestId("mcp-details-content")).toBeInTheDocument()

			fireEvent.click(header)
			expect(screen.queryByTestId("mcp-details-content")).not.toBeInTheDocument()
		})

		it("shows arguments code block when details are expanded", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					text='{"query": "react hooks"}'
					isArguments={true}
				/>,
			)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			const codeBlocks = screen.getAllByTestId("code-block")
			expect(codeBlocks.length).toBeGreaterThanOrEqual(1)
		})

		it("shows McpToolRow when details are expanded with useMcpServer", () => {
			render(
				<McpExecution
					executionId="test-1"
					useMcpServer={{
						type: "use_mcp_tool",
						serverName: "my-server",
						toolName: "my-tool",
						arguments: '{"key": "value"}',
					}}
					server={{
						tools: [{ name: "my-tool", description: "A useful tool", alwaysAllow: false }],
						source: "global",
					}}
				/>,
			)

			// Not visible initially
			expect(screen.queryByTestId("mcp-tool-row")).not.toBeInTheDocument()

			// Click to expand
			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			expect(screen.getByTestId("mcp-tool-row")).toBeInTheDocument()
			expect(screen.getByTestId("mcp-tool-row-name")).toHaveTextContent("my-tool")
			expect(screen.getByTestId("mcp-tool-row-description")).toHaveTextContent("A useful tool")
		})
	})

	describe("response sub-section collapse/expand", () => {
		it("does not show response header when there is no response and details are expanded", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					text='{"query": "test"}'
					isArguments={true}
				/>,
			)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			expect(screen.queryByTestId("mcp-response-header")).not.toBeInTheDocument()
		})

		it("shows response header when response exists and details are expanded", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					useMcpServer={{
						type: "use_mcp_tool",
						serverName: "context7",
						toolName: "query-docs",
						arguments: "{}",
						response: "Some response text",
					}}
				/>,
			)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			expect(screen.getByTestId("mcp-response-header")).toBeInTheDocument()
			expect(screen.getByText("Response")).toBeInTheDocument()
		})
	})

	describe("hasResponse conditional rendering", () => {
		it("shows response section when useMcpServer has response text", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					useMcpServer={{
						type: "use_mcp_tool",
						serverName: "context7",
						toolName: "query-docs",
						arguments: "{}",
						response: "Tool executed successfully",
					}}
				/>,
			)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			expect(screen.getByTestId("mcp-response-header")).toBeInTheDocument()
		})

		it("hides response section when response is empty string", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					useMcpServer={{
						type: "use_mcp_tool",
						serverName: "context7",
						toolName: "query-docs",
						arguments: "{}",
						response: "",
					}}
				/>,
			)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			expect(screen.queryByTestId("mcp-response-header")).not.toBeInTheDocument()
		})

		it("hides response section when useMcpServer has no response property", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					useMcpServer={{
						type: "use_mcp_tool",
						serverName: "context7",
						toolName: "query-docs",
						arguments: "{}",
					}}
				/>,
			)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			expect(screen.queryByTestId("mcp-response-header")).not.toBeInTheDocument()
		})

		it("response content is hidden by default within expanded details", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					useMcpServer={{
						type: "use_mcp_tool",
						serverName: "context7",
						toolName: "query-docs",
						arguments: "{}",
						response: "Response content here",
					}}
				/>,
			)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			// Response header is visible
			expect(screen.getByTestId("mcp-response-header")).toBeInTheDocument()
			// But the response content (markdown) should not be visible since it's collapsed
			expect(screen.queryByTestId("markdown")).not.toBeInTheDocument()
		})

		it("shows response content when response section is expanded", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					useMcpServer={{
						type: "use_mcp_tool",
						serverName: "context7",
						toolName: "query-docs",
						arguments: "{}",
						response: "Response content here",
					}}
				/>,
			)

			// First expand details
			fireEvent.click(screen.getByTestId("mcp-execution-header"))
			// Then expand response
			fireEvent.click(screen.getByTestId("mcp-response-header"))

			expect(screen.getByTestId("markdown")).toHaveTextContent("Response content here")
		})

		it("response chevron rotates when toggled", () => {
			render(
				<McpExecution
					executionId="test-1"
					serverName="context7"
					toolName="query-docs"
					useMcpServer={{
						type: "use_mcp_tool",
						serverName: "context7",
						toolName: "query-docs",
						arguments: "{}",
						response: "Some response",
					}}
				/>,
			)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			// Find the response chevron (it's inside the response header button)
			const responseHeader = screen.getByTestId("mcp-response-header")
			const responseChevron = responseHeader.querySelector(".size-3")
			expect(responseChevron).toHaveClass("-rotate-90")

			// Click to expand response
			fireEvent.click(responseHeader)
			expect(responseChevron).toHaveClass("rotate-0")
			expect(responseChevron).not.toHaveClass("-rotate-90")
		})
	})

	describe("chevron rotation", () => {
		it("renders details chevron rotated -90deg when collapsed", () => {
			render(<McpExecution executionId="test-1" serverName="context7" toolName="query-docs" />)

			const chevron = screen.getByTestId("mcp-details-chevron")
			expect(chevron).toHaveClass("-rotate-90")
			expect(chevron).not.toHaveClass("rotate-0")
		})

		it("renders details chevron at 0deg when expanded", () => {
			render(<McpExecution executionId="test-1" serverName="context7" toolName="query-docs" />)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			const chevron = screen.getByTestId("mcp-details-chevron")
			expect(chevron).toHaveClass("rotate-0")
			expect(chevron).not.toHaveClass("-rotate-90")
		})
	})

	describe("fallback behavior without useMcpServer", () => {
		it("shows McpToolRow from direct props when expanded and useMcpServer is absent", () => {
			render(<McpExecution executionId="test-1" serverName="direct-server" toolName="direct-tool" />)

			fireEvent.click(screen.getByTestId("mcp-execution-header"))

			expect(screen.getByTestId("mcp-tool-row")).toBeInTheDocument()
			expect(screen.getByTestId("mcp-tool-row-name")).toHaveTextContent("direct-tool")
			expect(screen.getByTestId("mcp-tool-row-server")).toHaveTextContent("direct-server")
		})
	})
})
