// npx vitest run packages/types/src/__tests__/compact-profile-settings.spec.ts

import {
	createKnownPersistedProviderProfile,
	isCompactProfile,
	providerProfileToLegacySettings,
	providerSettingsSchema,
	sharedProfileSettingsSchema,
} from "../index.js"

describe("compact profile provider setting", () => {
	it("serializes as absent when unset (never null)", () => {
		const parsed = providerSettingsSchema.parse({ apiProvider: "openai" })

		expect("compactProfile" in parsed).toBe(false)
		// The self-hosted settings client rejects nulls, so the JSON form must
		// simply omit the key rather than carry `null`.
		expect(JSON.stringify(parsed)).not.toContain("compactProfile")
		expect(JSON.stringify(parsed)).not.toContain("null")
	})

	it("rejects a null value rather than coercing it", () => {
		expect(providerSettingsSchema.safeParse({ apiProvider: "openai", compactProfile: null }).success).toBe(false)
		expect(sharedProfileSettingsSchema.safeParse({ compactProfile: null }).success).toBe(false)
	})

	it("accepts both booleans and keeps false as false", () => {
		expect(providerSettingsSchema.parse({ apiProvider: "openai", compactProfile: true }).compactProfile).toBe(true)
		expect(providerSettingsSchema.parse({ apiProvider: "openai", compactProfile: false }).compactProfile).toBe(
			false,
		)
	})

	it("round-trips through the persisted profile payload the editor saves", () => {
		// The profile editor sends a flat ProviderSettings object; it is stored as
		// a structured profile (the flag belongs to the shared section, it is not
		// provider-specific) and read back flat.
		const profile = createKnownPersistedProviderProfile({
			apiProvider: "openai",
			openAiBaseUrl: "http://127.0.0.1:8080/v1",
			compactProfile: true,
			slimToolset: true,
		})

		expect("config" in profile.provider ? profile.provider.config : {}).not.toHaveProperty("compactProfile")
		expect("shared" in profile ? profile.shared : undefined).toEqual({ compactProfile: true, slimToolset: true })
		expect(providerProfileToLegacySettings(profile)).toEqual({
			apiProvider: "openai",
			openAiBaseUrl: "http://127.0.0.1:8080/v1",
			compactProfile: true,
			slimToolset: true,
		})
	})

	it("keeps an explicit false through the round trip", () => {
		const profile = createKnownPersistedProviderProfile({ apiProvider: "openai", compactProfile: false })

		expect("shared" in profile ? profile.shared : undefined).toEqual({ compactProfile: false })
		expect(providerProfileToLegacySettings(profile)).toEqual({ apiProvider: "openai", compactProfile: false })
	})

	it("keeps an unset flag out of the persisted profile entirely", () => {
		const profile = createKnownPersistedProviderProfile({ apiProvider: "openai", slimToolset: true })

		expect(JSON.stringify(profile)).not.toContain("compactProfile")
	})
})

describe("isCompactProfile", () => {
	it("is on only for an explicit true", () => {
		expect(isCompactProfile({ compactProfile: true })).toBe(true)
	})

	it.each([
		["undefined settings", undefined],
		["null settings", null],
		["an empty profile", {}],
		["an explicit false", { compactProfile: false }],
	])("is off for %s", (_label, settings) => {
		expect(isCompactProfile(settings)).toBe(false)
	})

	it("is off for a value that is not the boolean true", () => {
		// A hand-edited or imported profile that bypassed the schema must not
		// switch the behaviour on by accident.
		expect(isCompactProfile({ compactProfile: "true" } as unknown as { compactProfile?: boolean })).toBe(false)
		expect(isCompactProfile({ compactProfile: 1 } as unknown as { compactProfile?: boolean })).toBe(false)
	})

	it("reads a full provider profile as it is", () => {
		const settings = providerSettingsSchema.parse({ apiProvider: "openai", compactProfile: true })

		expect(isCompactProfile(settings)).toBe(true)
		expect(isCompactProfile({ ...settings, compactProfile: undefined })).toBe(false)
	})
})
