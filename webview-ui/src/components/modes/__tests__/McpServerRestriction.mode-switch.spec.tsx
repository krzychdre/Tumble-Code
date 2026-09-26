// Regression: selecting a mode must not rewrite its MCP server allowlist.
//
// ModesView keeps one McpServerRestriction instance while the user switches
// modes. Switching from an unrestricted mode to one with an allowlist turns the
// "Restrict to specific MCP servers" checkbox on through its `checked` prop.
// The deprecated toolkit checkbox fired onChange for that prop change as if
// the user had clicked, so handleToggle reset the list to [] and the debounced
// flush persisted the empty allowlist. The toolkit is deliberately not mocked.

import { act, render } from "@/utils/test-utils"

import type { McpServer } from "@roo-code/types"

import { McpServerRestrictionImpl as McpServerRestriction } from "../McpServerRestriction"

const servers = [{ name: "a" }, { name: "b" }] as McpServer[]
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

describe("McpServerRestriction mode switch", () => {
	it("keeps the allowlist of the mode switched to and persists nothing", async () => {
		const onChange = vi.fn()
		const { rerender } = render(
			<McpServerRestriction slug="unrestricted" value={undefined} mcpServers={servers} onChange={onChange} />,
		)
		await wait(50)

		rerender(<McpServerRestriction slug="restricted" value={["a", "b"]} mcpServers={servers} onChange={onChange} />)
		// Longer than the 150 ms persistence debounce.
		await wait(400)

		expect(onChange).not.toHaveBeenCalled()
	})
})
