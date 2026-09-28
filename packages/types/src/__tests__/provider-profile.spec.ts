import {
	PROVIDER_PROFILES_SCHEMA_VERSION,
	UnsupportedProviderProfilesVersionError,
	createKnownPersistedProviderProfile,
	parseProviderProfilesEnvelope,
	providerFieldOwnership,
} from "../provider-profile.js"
import { PROVIDER_SETTINGS_KEYS } from "../provider-settings.js"
import { SECRET_STATE_KEYS } from "../global-settings.js"

describe("provider profile envelope", () => {
	it("rejects an unversioned record with UnsupportedProviderProfilesVersionError", () => {
		const unversioned = { currentApiConfigName: "a", apiConfigs: { a: { apiProvider: "openai" } } }
		expect(() => parseProviderProfilesEnvelope(unversioned)).toThrow(UnsupportedProviderProfilesVersionError)
	})

	it("rejects other versions without interpreting their data", () => {
		expect(() =>
			parseProviderProfilesEnvelope({ schemaVersion: PROVIDER_PROFILES_SCHEMA_VERSION + 1, data: null }),
		).toThrow(UnsupportedProviderProfilesVersionError)
	})

	it("does not mutate its input", () => {
		const input = {
			schemaVersion: PROVIDER_PROFILES_SCHEMA_VERSION,
			data: {
				currentApiConfigName: "a",
				apiConfigs: { a: { id: "a-id", provider: { providerId: "openai", config: {} } } },
				futureTopLevelField: { preserved: true },
			},
		}
		const snapshot = structuredClone(input)
		expect(parseProviderProfilesEnvelope(input).data.futureTopLevelField).toEqual({ preserved: true })
		expect(input).toEqual(snapshot)
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
