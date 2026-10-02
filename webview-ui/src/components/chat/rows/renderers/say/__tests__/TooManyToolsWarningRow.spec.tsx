import type { ClineMessage } from "@tumble-code/types"
import { TOO_MANY_TOOLS_DISMISSAL_ID } from "@tumble-code/types"

import { render, screen, fireEvent } from "@/utils/test-utils"
import { vscode } from "@src/utils/vscode"

import { TooManyToolsWarningRow } from "../StatusRows"
import type { RowRendererProps } from "../../types"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const props: RowRendererProps = {
	message: {
		type: "say",
		say: "too_many_tools_warning",
		ts: 1,
		text: JSON.stringify({ toolCount: 80, serverCount: 5, threshold: 60 }),
	} as ClineMessage,
	isExpanded: false,
	isLast: false,
	isStreaming: false,
	toggleExpand: () => {},
	meta: { nextTs: 2, previousTodos: [], newTaskIndex: undefined, followedBySubtaskResult: false },
}

describe("TooManyToolsWarningRow", () => {
	it("hides the row and stores the dismissal when the close button is clicked", () => {
		const { container } = render(<TooManyToolsWarningRow {...props} />)

		const close = screen.getByRole("button", { name: "common:dismiss" })
		expect(close).toHaveAttribute("title", "common:dismissAndDontShowAgain")
		fireEvent.click(close)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "dismissUpsell",
			upsellId: TOO_MANY_TOOLS_DISMISSAL_ID,
		})
		expect(container.firstChild).toBeNull()
	})
})
