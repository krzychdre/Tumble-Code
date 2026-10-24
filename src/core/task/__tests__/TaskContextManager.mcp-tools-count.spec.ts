// npx vitest run core/task/__tests__/TaskContextManager.mcp-tools-count.spec.ts

import { McpServerManager } from "../../../services/mcp/McpServerManager"
import { logger } from "../../../utils/logging"
import { TaskContextManager, type TaskContextManagerAccess } from "../TaskContextManager"

vi.mock("../../../services/mcp/McpServerManager", () => ({
	McpServerManager: { getInstance: vi.fn() },
}))

const getInstance = vi.mocked(McpServerManager.getInstance)

/** The count the too-many-tools warning compares against its threshold. */
function countFor(provider: unknown) {
	const access = { providerRef: { deref: () => provider } } as unknown as TaskContextManagerAccess
	return new TaskContextManager(access).getEnabledMcpToolsCount()
}

const provider = (mcpEnabled?: boolean) => ({ context: {}, getState: async () => ({ mcpEnabled }) })

describe("TaskContextManager.getEnabledMcpToolsCount", () => {
	beforeEach(() => vi.clearAllMocks())
	afterEach(() => vi.restoreAllMocks())

	it("counts the prompt-enabled tools of connected, enabled servers", async () => {
		getInstance.mockResolvedValue({
			getServers: () => [
				{ status: "connected", tools: [{ name: "a" }, { name: "b", enabledForPrompt: false }, { name: "c" }] },
				{ status: "connected", disabled: true, tools: [{ name: "d" }] },
				{ status: "disconnected", tools: [{ name: "e" }] },
			],
		} as any)

		// mcpEnabled unset falls back to the default, which is on.
		expect(await countFor(provider(undefined))).toEqual({ enabledToolCount: 2, enabledServerCount: 1 })
	})

	it.each([
		["the provider is gone", undefined],
		["MCP is turned off", provider(false)],
	])("is zero without asking the hub when %s", async (_label, current) => {
		expect(await countFor(current)).toEqual({ enabledToolCount: 0, enabledServerCount: 0 })
		expect(getInstance).not.toHaveBeenCalled()
	})

	it("is zero and logs when the hub cannot be reached", async () => {
		const failure = new Error("spawn failed")
		getInstance.mockRejectedValue(failure)
		const error = vi.spyOn(logger, "error").mockImplementation(() => {})

		expect(await countFor(provider(true))).toEqual({ enabledToolCount: 0, enabledServerCount: 0 })
		expect(error).toHaveBeenCalledWith(expect.stringContaining("Error counting MCP tools"), failure)
	})
})
