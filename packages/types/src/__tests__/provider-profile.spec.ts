import {
	PROVIDER_PROFILES_SCHEMA_VERSION,
	UnsupportedProviderProfilesVersionError,
	migrateProviderProfiles,
} from "../provider-profile.js"

describe("provider profile persistence", () => {
	const legacyProfiles = {
		currentApiConfigName: "future",
		apiConfigs: {
			future: {
				id: "future-id",
				apiProvider: "future-provider",
				futureApiKey: "preserve-me",
				futureSettings: { nested: true },
			},
			retired: {
				id: "retired-id",
				apiProvider: "groq",
				groqApiKey: "preserve-me-too",
			},
		},
		futureTopLevelField: { preserved: true },
	}

	it("migrates an unversioned legacy shape into lossless opaque tombstones", () => {
		const migrated = migrateProviderProfiles(legacyProfiles)

		expect(migrated.schemaVersion).toBe(PROVIDER_PROFILES_SCHEMA_VERSION)
		expect(migrated.data.futureTopLevelField).toEqual(legacyProfiles.futureTopLevelField)
		for (const name of ["future", "retired"] as const) {
			const profile = migrated.data.apiConfigs[name]
			expect(profile).toBeDefined()
			if (!profile) throw new Error(`Missing ${name} profile`)
			expect(profile.provider).toEqual({
				providerId: legacyProfiles.apiConfigs[name].apiProvider,
				opaqueLegacyPayload: legacyProfiles.apiConfigs[name],
			})
		}
	})

	it("is deterministic, idempotent, and does not mutate input", () => {
		const input = migrateProviderProfiles(legacyProfiles)
		const snapshot = structuredClone(input)
		const first = migrateProviderProfiles(input)
		const second = migrateProviderProfiles(first)

		expect(first).toEqual(second)
		expect(input).toEqual(snapshot)
	})

	it("rejects unsupported future versions without interpreting their data", () => {
		expect(() =>
			migrateProviderProfiles({
				schemaVersion: PROVIDER_PROFILES_SCHEMA_VERSION + 1,
				data: legacyProfiles,
			}),
		).toThrow(UnsupportedProviderProfilesVersionError)
	})
})
