import {
	PROVIDER_PROFILES_SCHEMA_VERSION,
	UnsupportedProviderProfilesVersionError,
	createKnownPersistedProviderProfile,
	extractLegacyInlineSecrets,
	migrateProviderProfiles,
	providerFieldOwnership,
} from "../provider-profile.js"
import { PROVIDER_SETTINGS_KEYS } from "../provider-settings.js"
import { SECRET_STATE_KEYS } from "../global-settings.js"

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

// Saving a profile splits it in two: the persisted envelope keeps the fields a
// provider config owns (plus the shared settings), and the secret store keeps
// SECRET_STATE_KEYS. A field that is in neither is silently dropped on save.
describe("vertex JSON credentials survive a profile save", () => {
	const VERTEX_JSON = JSON.stringify({ type: "service_account", client_email: "sa@p.iam.gserviceaccount.com" })

	it("routes vertexJsonCredentials to the secret store, not the persisted envelope", () => {
		const saved = createKnownPersistedProviderProfile({
			apiProvider: "vertex",
			vertexJsonCredentials: VERTEX_JSON,
			vertexProjectId: "p",
		})

		// The envelope must never carry the credential in plain text ...
		expect(JSON.stringify(saved)).not.toContain("service_account")
		// ... so the secret store has to be the place that keeps it.
		expect(SECRET_STATE_KEYS as readonly string[]).toContain("vertexJsonCredentials")
	})

	it("seeds an inline legacy vertexJsonCredentials into the secret store on migration", () => {
		expect(
			extractLegacyInlineSecrets({
				apiProvider: "vertex",
				vertexJsonCredentials: VERTEX_JSON,
				vertexProjectId: "p",
			}),
		).toEqual({ vertexJsonCredentials: VERTEX_JSON })
	})

	it("keeps every provider settings field somewhere when a profile is saved", () => {
		const shared = [
			"includeMaxTokens",
			"todoListEnabled",
			"enableReasoningEffort",
			"modelTemperature",
			"rateLimitSeconds",
			"consecutiveMistakeLimit",
			"slimToolset",
			"slimHidesMcp",
			"reasoningEffort",
			"modelMaxTokens",
			"modelMaxThinkingTokens",
			"verbosity",
			"codebaseIndexOpenAiCompatibleBaseUrl",
			"codebaseIndexOpenAiCompatibleModelDimension",
		]
		const owned = new Set(Object.values(providerFieldOwnership).flat())
		const dropped = PROVIDER_SETTINGS_KEYS.filter(
			(key) =>
				key !== "apiProvider" &&
				!owned.has(key) &&
				!shared.includes(key) &&
				!(SECRET_STATE_KEYS as readonly string[]).includes(key),
		)
		expect(dropped).toEqual([])
	})
})
