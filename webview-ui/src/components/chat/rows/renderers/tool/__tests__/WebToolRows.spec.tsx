import { fireEvent, render, screen } from "@/utils/test-utils"
import type { ClineMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

import { WebFetchToolRow, WebSearchToolRow } from "../SearchToolRows"
import type { ToolRendererProps } from "../../types"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			options && Object.keys(options).length > 0 ? `${key} ${JSON.stringify(options)}` : key,
	}),
	Trans: () => null,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

const props = (tool: ToolRendererProps["tool"], message: Partial<ClineMessage> = {}): ToolRendererProps => ({
	message: { ts: 1000, type: "ask", ask: "tool", text: JSON.stringify(tool), ...message },
	tool,
	isExpanded: false,
	isLast: false,
	isStreaming: false,
	toggleExpand: () => {},
	meta: { nextTs: 2200, previousTodos: [], newTaskIndex: undefined, followedBySubtaskResult: false },
})

describe("WebSearchToolRow", () => {
	it("lists each query on its own line with a count", () => {
		render(<WebSearchToolRow {...props({ tool: "webSearch", queries: ["first query", "second", " "] })} />)
		expect(screen.getByText("chat:webSearch.title")).toBeInTheDocument()
		expect(screen.getByText('chat:webSearch.queryCount {"count":2}')).toBeInTheDocument()
		const items = screen.getAllByRole("listitem")
		expect(items.map((item) => item.textContent)).toEqual(["first query", "second"])
	})

	it("shows only the header while the queries are still streaming in", () => {
		render(<WebSearchToolRow {...props({ tool: "webSearch", queries: [] }, { partial: true })} />)
		expect(screen.getByText("chat:webSearch.title")).toBeInTheDocument()
		expect(screen.queryByRole("list")).not.toBeInTheDocument()
	})
})

describe("WebFetchToolRow", () => {
	beforeEach(() => vi.mocked(vscode.postMessage).mockClear())

	it("shows host and path and opens the page in the browser", () => {
		const url = "https://www.elektroda.pl/rtvforum/topic4152564.html"
		render(<WebFetchToolRow {...props({ tool: "webFetch", fetchedUrl: url })} />)
		expect(screen.getByText("elektroda.pl")).toBeInTheDocument()
		expect(screen.getByText("/rtvforum/topic4152564.html")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button"))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "openExternal", url })
	})

	it("shows a URL that is not http(s) as plain text with no link", () => {
		render(<WebFetchToolRow {...props({ tool: "webFetch", fetchedUrl: "javascript:alert(1)" })} />)
		expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument()
		expect(screen.queryByRole("button")).not.toBeInTheDocument()
	})
})
