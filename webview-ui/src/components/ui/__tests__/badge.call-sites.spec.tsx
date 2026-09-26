// Characterization of the webview's VSCodeBadge call sites (refactor DEP-9:
// the deprecated `VSCodeBadge` from @vscode/webview-ui-toolkit is being
// replaced). The toolkit is NOT mocked: in jsdom it renders a `<vscode-badge>`
// custom element that carries the call site's className and style, with the
// text slotted into a shadow `.control`. `badgeHost` resolves both that and
// the replacement (class `ui-badge`), so the assertions hold before and after.

import React from "react"

import type { ClineMessage, ClineSayTool } from "@roo-code/types"

import { render, screen } from "@/utils/test-utils"

import { CondensationResultRow } from "@src/components/chat/context-management/CondensationResultRow"
import { SkillToolRow, RunSlashCommandToolRow } from "@src/components/chat/rows/renderers/tool/ExpandableToolRows"

vi.mock("react-i18next", async () => {
	const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next")
	return { ...actual, useTranslation: () => ({ t: (key: string) => key }) }
})

const badgeHost = (text: string) => {
	const host = screen.getByText(text).closest("vscode-badge, .ui-badge") as HTMLElement | null
	expect(host).not.toBeNull()
	return host!
}

const toolProps = (tool: Partial<ClineSayTool>) =>
	({
		message: { type: "ask", ask: "tool", ts: 1 } as ClineMessage,
		tool: tool as ClineSayTool,
		isExpanded: false,
		isLast: false,
		isStreaming: false,
		toggleExpand: () => {},
		meta: {} as never,
	}) as const

describe("VSCodeBadge call sites (replacement characterization)", () => {
	it("CondensationResultRow: shows the cost, visible only when it is above zero", () => {
		const { rerender } = render(
			<CondensationResultRow
				data={{ cost: 0.1234, prevContextTokens: 1000, newContextTokens: 200, summary: "s" }}
			/>,
		)
		expect(badgeHost("$0.12")).toHaveClass("opacity-100")

		rerender(
			<CondensationResultRow data={{ cost: 0, prevContextTokens: 1000, newContextTokens: 200, summary: "s" }} />,
		)
		expect(badgeHost("$0.00")).toHaveClass("opacity-0")
	})

	it("SkillToolRow and RunSlashCommandToolRow: the source badge keeps the call site's font size", () => {
		render(
			<>
				<SkillToolRow {...toolProps({ tool: "skill", skill: "review", source: "project" } as never)} />
				<RunSlashCommandToolRow
					{...toolProps({ tool: "runSlashCommand", command: "deploy", source: "global" } as never)}
				/>
			</>,
		)

		for (const text of ["project", "global"]) {
			expect(badgeHost(text).style.fontSize).toBe("calc(var(--vscode-font-size) - 2px)")
		}
	})
})
