import { promptComponentSchema } from "../mode.js"

// Built-in modes (code, architect, ask, debug) cannot carry an `allowedMcpServers`
// on a ModeConfig — they are customized through `customModePrompts` (a per-slug
// PromptComponent override). These specs lock in that the override channel accepts the
// allowlist with the SAME semantics as modeConfigSchema.allowedMcpServers:
//   omitted  → unrestricted (all servers)
//   []       → no servers
//   [names]  → only the listed servers
describe("promptComponentSchema allowedMcpServers", () => {
	it("should accept a valid allowedMcpServers array of strings", () => {
		const result = promptComponentSchema.safeParse({
			roleDefinition: "Built-in override",
			allowedMcpServers: ["server1", "server2"],
		})
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data.allowedMcpServers).toEqual(["server1", "server2"])
		}
	})

	it("should accept missing/undefined allowedMcpServers (unrestricted)", () => {
		const result = promptComponentSchema.safeParse({ roleDefinition: "Built-in override" })
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data.allowedMcpServers).toBeUndefined()
		}
	})

	it("should accept an empty allowedMcpServers array (restrict to no servers)", () => {
		const result = promptComponentSchema.safeParse({ allowedMcpServers: [] })
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data.allowedMcpServers).toEqual([])
		}
	})

	it("should reject non-string array items", () => {
		const result = promptComponentSchema.safeParse({ allowedMcpServers: [123, 456] })
		expect(result.success).toBe(false)
	})

	it("should reject a non-array value", () => {
		const result = promptComponentSchema.safeParse({ allowedMcpServers: "server1" })
		expect(result.success).toBe(false)
	})
})
