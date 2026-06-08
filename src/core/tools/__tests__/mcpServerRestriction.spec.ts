// npx vitest run core/tools/__tests__/mcpServerRestriction.spec.ts

import type { Task } from "../../task/Task"
import type { ModeConfig, CustomModePrompts } from "@roo-code/types"
import { isMcpServerAllowed, getAllowedMcpServersForTask, ensureMcpServerAllowed } from "../mcpServerRestriction"
import { defaultModeSlug } from "../../../shared/modes"

// These specs drive the guard through the REAL `getModeAllowedMcpServers` resolver (no module mock)
// so they exercise the full path: provider state → resolver → enforcement. The resolver's own
// precedence rules are unit-tested in src/shared/__tests__/modes.spec.ts; here we prove the guard
// honors whatever the resolver returns for both custom modes (ModeConfig allowlist) and built-in
// modes (customModePrompts override).

const toolError = (error: string) => `ERR:${error}`

function makeTask(state: any): Task {
	return {
		providerRef: {
			deref: () => ({
				getState: vi.fn().mockResolvedValue(state),
			}),
		},
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		recordToolError: vi.fn(),
	} as unknown as Task
}

// A custom mode carries its allowlist on the ModeConfig.
function customModeWithAllowlist(allowedMcpServers?: string[]): ModeConfig {
	return {
		slug: "custom-mcp",
		name: "Custom MCP",
		roleDefinition: "",
		groups: ["mcp"],
		...(allowedMcpServers !== undefined ? { allowedMcpServers } : {}),
		source: "global",
	} as ModeConfig
}

// A built-in mode (e.g. "code") carries its allowlist as a customModePrompts override.
function builtInOverride(allowedMcpServers?: string[]): CustomModePrompts {
	return allowedMcpServers !== undefined ? { code: { allowedMcpServers } } : {}
}

describe("isMcpServerAllowed", () => {
	it("allows all servers when allowlist is undefined (backward compatible)", () => {
		expect(isMcpServerAllowed("any-server", undefined)).toBe(true)
	})

	it("rejects all servers when allowlist is empty", () => {
		expect(isMcpServerAllowed("any-server", [])).toBe(false)
	})

	it("allows a server present in a populated allowlist", () => {
		expect(isMcpServerAllowed("allowed", ["allowed", "other"])).toBe(true)
	})

	it("rejects a server absent from a populated allowlist", () => {
		expect(isMcpServerAllowed("disallowed", ["allowed", "other"])).toBe(false)
	})
})

describe("getAllowedMcpServersForTask", () => {
	it("returns a custom mode's ModeConfig allowlist", async () => {
		const task = makeTask({ mode: "custom-mcp", customModes: [customModeWithAllowlist(["srv-a"])] })
		await expect(getAllowedMcpServersForTask(task)).resolves.toEqual(["srv-a"])
	})

	it("returns a built-in mode's customModePrompts override allowlist", async () => {
		const task = makeTask({ mode: "code", customModes: [], customModePrompts: builtInOverride(["srv-b"]) })
		await expect(getAllowedMcpServersForTask(task)).resolves.toEqual(["srv-b"])
	})

	it("returns an empty-array override for a built-in mode (restrict to no servers)", async () => {
		const task = makeTask({ mode: "code", customModes: [], customModePrompts: builtInOverride([]) })
		await expect(getAllowedMcpServersForTask(task)).resolves.toEqual([])
	})

	it("returns undefined when the built-in mode does not restrict servers", async () => {
		const task = makeTask({ mode: "code", customModes: [], customModePrompts: {} })
		await expect(getAllowedMcpServersForTask(task)).resolves.toBeUndefined()
	})

	it("defaults to the default mode slug when state has no mode", async () => {
		// No `mode` on state → falls back to defaultModeSlug; an override keyed on that slug applies.
		const task = makeTask({
			customModes: [],
			customModePrompts: { [defaultModeSlug]: { allowedMcpServers: ["srv-default"] } },
		})
		await expect(getAllowedMcpServersForTask(task)).resolves.toEqual(["srv-default"])
	})

	it("returns undefined when the provider has no getState", async () => {
		const task = { providerRef: { deref: () => ({}) } } as unknown as Task
		await expect(getAllowedMcpServersForTask(task)).resolves.toBeUndefined()
	})
})

describe("ensureMcpServerAllowed", () => {
	it("allows invocation when allowlist is undefined (allows all)", async () => {
		const task = makeTask({ mode: "code", customModes: [], customModePrompts: {} })
		const pushToolResult = vi.fn()

		const result = await ensureMcpServerAllowed(task, "use_mcp_tool", "anything", pushToolResult, toolError)

		expect(result).toBe(true)
		expect(pushToolResult).not.toHaveBeenCalled()
		expect(task.recordToolError).not.toHaveBeenCalled()
	})

	it("allows invocation when server is in the populated allowlist (built-in override)", async () => {
		const task = makeTask({ mode: "code", customModes: [], customModePrompts: builtInOverride(["allowed-server"]) })
		const pushToolResult = vi.fn()

		const result = await ensureMcpServerAllowed(task, "use_mcp_tool", "allowed-server", pushToolResult, toolError)

		expect(result).toBe(true)
		expect(pushToolResult).not.toHaveBeenCalled()
	})

	it("rejects invocation when server is NOT in a built-in mode's customModePrompts allowlist", async () => {
		// The headline of this change: a BUILT-IN mode can now restrict MCP servers via the override,
		// and the exec-time guard enforces it.
		const task = makeTask({ mode: "code", customModes: [], customModePrompts: builtInOverride(["allowed-server"]) })
		const pushToolResult = vi.fn()

		const result = await ensureMcpServerAllowed(
			task,
			"use_mcp_tool",
			"disallowed-server",
			pushToolResult,
			toolError,
		)

		expect(result).toBe(false)
		expect(task.consecutiveMistakeCount).toBe(1)
		expect(task.didToolFailInCurrentTurn).toBe(true)
		expect(task.recordToolError).toHaveBeenCalledWith("use_mcp_tool")
		expect(pushToolResult).toHaveBeenCalledTimes(1)
		const message = (pushToolResult as any).mock.calls[0][0] as string
		expect(message).toContain("disallowed-server")
		expect(message).toContain("not allowed")
		expect(message).toContain("allowed-server")
	})

	it("rejects invocation when server is NOT in a custom mode's ModeConfig allowlist", async () => {
		const task = makeTask({ mode: "custom-mcp", customModes: [customModeWithAllowlist(["allowed-server"])] })
		const pushToolResult = vi.fn()

		const result = await ensureMcpServerAllowed(
			task,
			"use_mcp_tool",
			"disallowed-server",
			pushToolResult,
			toolError,
		)

		expect(result).toBe(false)
		expect(task.recordToolError).toHaveBeenCalledWith("use_mcp_tool")
	})

	it("rejects all invocations when a built-in mode's override allowlist is empty", async () => {
		const task = makeTask({ mode: "code", customModes: [], customModePrompts: builtInOverride([]) })
		const pushToolResult = vi.fn()

		const result = await ensureMcpServerAllowed(
			task,
			"access_mcp_resource",
			"any-server",
			pushToolResult,
			toolError,
		)

		expect(result).toBe(false)
		expect(task.recordToolError).toHaveBeenCalledWith("access_mcp_resource")
		const message = (pushToolResult as any).mock.calls[0][0] as string
		expect(message).toContain("No MCP servers are allowed")
	})
})
