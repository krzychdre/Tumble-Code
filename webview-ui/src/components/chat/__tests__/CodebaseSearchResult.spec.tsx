import { fireEvent, render, screen } from "@testing-library/react"
import { vi } from "vitest"

import CodebaseSearchResult from "../CodebaseSearchResult"

const mockPostMessage = vi.fn()

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (...args: unknown[]) => mockPostMessage(...args),
	},
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, opts?: { score?: string }) => (opts?.score ? `${key}:${opts.score}` : key),
	}),
}))

vi.mock("@/components/ui", () => ({
	StandardTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const props = {
	score: 0.9,
	startLine: 3,
	endLine: 5,
	snippet: "const a = 1",
	language: "ts",
}

describe("CodebaseSearchResult", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("opens a workspace-relative result with the ./ prefix", () => {
		render(<CodebaseSearchResult {...props} filePath="src/a.ts" />)

		fireEvent.click(screen.getByText("a.ts:3-5"))

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "openFile",
			text: "./src/a.ts",
			values: { line: 3 },
		})
	})

	it("sends a Windows absolute result path untouched to openFile", () => {
		const { container } = render(
			// JSX string attributes do not process backslash escapes, so use a
			// TS expression to get real single-backslash separators.
			<CodebaseSearchResult {...props} filePath={"C:\\Users\\test\\app\\src\\a.ts"} />,
		)

		// The label splits on "/" only, so the backslash path is one text
		// node; click the outer clickable row instead.
		fireEvent.click(container.querySelector(".cursor-pointer") as HTMLElement)

		// No "./" prefix: the extension must see the absolute Windows path.
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "openFile",
			text: "C:\\Users\\test\\app\\src\\a.ts",
			values: { line: 3 },
		})
	})
})
