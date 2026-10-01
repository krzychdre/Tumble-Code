import userEvent from "@testing-library/user-event"
import { render, screen } from "@/utils/test-utils"
import type { ClineMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

import { ReadFileToolRow } from "../FileToolRows"
import type { ToolRendererProps } from "../../types"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	Trans: () => null,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

const props = (tool: ToolRendererProps["tool"], message: Partial<ClineMessage> = {}): ToolRendererProps => ({
	message: { ts: 1000, type: "say", say: "tool", text: JSON.stringify(tool), ...message },
	tool,
	isExpanded: false,
	isLast: false,
	isStreaming: false,
	toggleExpand: () => {},
	meta: { nextTs: 2200, previousTodos: [], newTaskIndex: undefined, followedBySubtaskResult: false },
})

describe("ReadFileToolRow", () => {
	beforeEach(() => vi.mocked(vscode.postMessage).mockClear())

	it("opens the file from the keyboard", async () => {
		const user = userEvent.setup()
		render(
			<ReadFileToolRow
				{...props({ tool: "readFile", path: "src/a.ts", content: "/ws/src/a.ts", startLine: 12 })}
			/>,
		)

		await user.tab()
		expect(screen.getByRole("button")).toHaveFocus()
		await user.keyboard("{Enter}")

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openFile",
			text: "/ws/src/a.ts",
			values: { line: 12 },
		})
	})
})
