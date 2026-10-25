// npx vitest run src/__tests__/cloud.test.ts

import { isLoopbackAuthRedirect, organizationSettingsSchema, userSettingsConfigSchema } from "../cloud.js"

/**
 * Zod drops keys a schema does not declare, so a field missing from a schema
 * silently vanishes between the cloud API and the extension. These pin every
 * settings field the extension reads.
 */
describe("cloud settings schemas", () => {
	const organization = {
		version: 1,
		cloudSettings: {
			recordTaskMessages: true,
			enableTaskSharing: true,
			allowPublicTaskSharing: false,
			taskShareExpirationDays: 30,
			allowMembersViewAllTasks: true,
			workspaceTaskVisibility: "list-only",
			llmEnhancedFeaturesEnabled: true,
		},
		defaultSettings: { disabledTools: ["execute_command", "write_to_file"], maxOpenTabsContext: 5 },
		allowList: { allowAll: false, providers: { openai: { allowAll: true, models: ["gpt-4"] } } },
		features: {},
		hiddenMcps: ["test-mcp"],
		hideMarketplaceMcps: true,
		mcps: [],
		providerProfiles: {},
	}

	it("keeps every organization settings field", () => {
		expect(organizationSettingsSchema.parse(organization)).toEqual(organization)
	})

	it("keeps every user settings field", () => {
		const user = { taskSyncEnabled: false, llmEnhancedFeaturesEnabled: true }

		expect(userSettingsConfigSchema.parse(user)).toEqual(user)
	})

	it.each([
		["an unknown task visibility", { cloudSettings: { workspaceTaskVisibility: "everyone" } }],
		["an unknown disabled tool", { defaultSettings: { disabledTools: ["not_a_real_tool"] } }],
		["a negative tab count", { defaultSettings: { maxOpenTabsContext: -1 } }],
	])("rejects %s", (_name, override) => {
		expect(organizationSettingsSchema.safeParse({ ...organization, ...override }).success).toBe(false)
	})
})

describe("isLoopbackAuthRedirect", () => {
	it.each(["http://127.0.0.1:53682", "http://localhost:1024", "http://[::1]:65535"])("accepts %s", (value) => {
		expect(isLoopbackAuthRedirect(value)).toBe(true)
	})

	it.each([
		"vscode://QUB-IT.tumble-code",
		"https://127.0.0.1:53682",
		"http://127.0.0.1",
		"http://127.0.0.1:80",
		"http://127.0.0.1:1023",
		"http://127.0.0.1:65536",
		"http://127.0.0.1:01024",
		"http://127.0.0.1:53682/",
		"http://127.0.0.1:53682/auth/clerk/callback",
		"http://127.0.0.1:53682?x=1",
		"http://127.0.0.2:53682",
		"http://example.com:53682",
		"http://localhost.example.com:53682",
	])("rejects %s", (value) => {
		expect(isLoopbackAuthRedirect(value)).toBe(false)
	})
})
