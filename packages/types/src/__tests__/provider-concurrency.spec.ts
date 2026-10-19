import { providerSettingsSchema, subagentSlotsForProfile } from "../index.js"

describe("subagentSlotsForProfile", () => {
	it("sets no per-profile cap when the profile has no limit", () => {
		expect(subagentSlotsForProfile(undefined, false)).toBeUndefined()
		expect(subagentSlotsForProfile(undefined, true)).toBeUndefined()
	})

	it("gives every slot to subagents when the parent runs on another profile", () => {
		expect(subagentSlotsForProfile(1, false)).toBe(1)
		expect(subagentSlotsForProfile(4, false)).toBe(4)
	})

	it("keeps one slot for the parent when it runs on the same profile", () => {
		expect(subagentSlotsForProfile(4, true)).toBe(3)
		expect(subagentSlotsForProfile(2, true)).toBe(1)
	})

	it("leaves no slot when the parent alone fills the limit", () => {
		expect(subagentSlotsForProfile(1, true)).toBe(0)
	})
})

describe("maxConcurrentRequests in provider settings", () => {
	it("accepts a whole number from 1 and an absent value", () => {
		expect(providerSettingsSchema.safeParse({ maxConcurrentRequests: 1 }).success).toBe(true)
		expect(providerSettingsSchema.safeParse({ maxConcurrentRequests: 8 }).success).toBe(true)
		expect(providerSettingsSchema.safeParse({}).success).toBe(true)
	})

	it("rejects zero, negative and fractional values", () => {
		expect(providerSettingsSchema.safeParse({ maxConcurrentRequests: 0 }).success).toBe(false)
		expect(providerSettingsSchema.safeParse({ maxConcurrentRequests: -2 }).success).toBe(false)
		expect(providerSettingsSchema.safeParse({ maxConcurrentRequests: 1.5 }).success).toBe(false)
	})
})
