// cd src && ./node_modules/.bin/vitest run services/mcp/__tests__/McpServerManager.spec.ts

import type { ExtensionContext } from "vscode"

import { McpHub, type McpHubProvider } from "../McpHub"
import { McpServerManager } from "../McpServerManager"

vi.mock("../McpHub", () => ({
	McpHub: vi.fn(function () {
		return { waitUntilReady: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) }
	}),
}))

describe("McpServerManager", () => {
	const context = { globalState: { update: vi.fn() } } as unknown as ExtensionContext
	const provider = {} as McpHubProvider

	afterEach(async () => {
		await McpServerManager.cleanup(context)
		vi.clearAllMocks()
	})

	it("builds one hub for concurrent callers and records it in global state", async () => {
		const [first, second] = await Promise.all([
			McpServerManager.getInstance(context, provider),
			McpServerManager.getInstance(context, provider),
		])

		expect(McpHub).toHaveBeenCalledTimes(1)
		expect(McpHub).toHaveBeenCalledWith(provider)
		expect(first).toBe(second)
		expect(first.waitUntilReady).toHaveBeenCalled()
		expect(await McpServerManager.getInstance(context, provider)).toBe(first)
		expect(context.globalState.update).toHaveBeenCalledWith("mcpHubInstanceId", expect.any(String))
	})

	it("cleanup disposes the hub, forgets it and clears global state", async () => {
		const hub = await McpServerManager.getInstance(context, provider)

		await McpServerManager.cleanup(context)

		expect(hub.dispose).toHaveBeenCalled()
		expect(context.globalState.update).toHaveBeenLastCalledWith("mcpHubInstanceId", undefined)
		expect(await McpServerManager.getInstance(context, provider)).not.toBe(hub)
	})

	it("tries again after a hub that failed to start", async () => {
		vi.mocked(McpHub).mockImplementationOnce(function () {
			return { waitUntilReady: vi.fn().mockRejectedValue(new Error("boom")), dispose: vi.fn() } as any
		})

		await expect(McpServerManager.getInstance(context, provider)).rejects.toThrow("boom")

		await McpServerManager.getInstance(context, provider)
		expect(McpHub).toHaveBeenCalledTimes(2)
	})
})
