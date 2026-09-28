import {
	activeProviderIds,
	createKnownPersistedProviderProfile,
	knownProviderConfigurationSchema,
	parseProviderProfilesEnvelope,
	providerConfigSchemas,
	providerFieldOwnership,
	providerProfileToLegacySettings,
	providerProfilesEnvelopeSchema,
} from "../index.js"

// R4: shared fields live in the `shared` section of a persisted profile, not
// in the per-provider `config`, so they are deliberately excluded from
// `providerFieldOwnership[K]`. This list must mirror `sharedFieldNames` in
// provider-profile.ts. The parity test below asserts that every per-provider
// schema field is owned by exactly one entry in `providerFieldOwnership`, so a
// future schema addition forgotten in the ownership map is caught.
const SHARED_FIELD_NAMES = [
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
] as const

describe("provider configuration schemas", () => {
	it("is complete against the active provider registry", () => {
		expect(Object.keys(providerConfigSchemas).sort()).toEqual([...activeProviderIds].sort())
	})

	it.each(activeProviderIds)("accepts a minimal %s configuration", (providerId) => {
		expect(knownProviderConfigurationSchema.safeParse({ providerId, config: {} }).success).toBe(true)
	})

	it("strictly rejects cross-provider fields", () => {
		expect(
			knownProviderConfigurationSchema.safeParse({
				providerId: "anthropic",
				config: { openAiBaseUrl: "https://wrong.example" },
			}).success,
		).toBe(false)
	})

	it("round-trips through the single legacy compatibility boundary", () => {
		const profile = createKnownPersistedProviderProfile({
			apiProvider: "openai",
			openAiBaseUrl: "https://openai.example",
			rateLimitSeconds: 0,
		})
		expect(providerProfileToLegacySettings(profile)).toEqual({
			apiProvider: "openai",
			openAiBaseUrl: "https://openai.example",
			rateLimitSeconds: 0,
		})
	})
})

describe("stored provider profiles", () => {
	it("keeps absent/false/zero/empty values and isolates provider fields on save", () => {
		const known = createKnownPersistedProviderProfile({
			id: "known-id",
			apiProvider: "openai",
			openAiBaseUrl: "",
			openAiStreamingEnabled: false,
			rateLimitSeconds: 0,
			anthropicBaseUrl: "must-not-leak",
		})
		expect(known).toEqual({
			id: "known-id",
			provider: {
				providerId: "openai",
				config: { openAiBaseUrl: "", openAiStreamingEnabled: false },
			},
			shared: { rateLimitSeconds: 0 },
		})
		expect(JSON.stringify(known)).not.toContain("anthropicBaseUrl")
	})

	it("parses the current envelope unchanged", () => {
		const envelope = {
			schemaVersion: 2,
			data: {
				currentApiConfigName: "known",
				apiConfigs: {
					known: { id: "known-id", provider: { providerId: "openai", config: { openAiModelId: "m" } } },
					retired: {
						id: "retired-id",
						provider: { providerId: "glama", opaqueLegacyPayload: { apiProvider: "glama" } },
					},
				},
			},
		}
		expect(parseProviderProfilesEnvelope(envelope)).toEqual(envelope)
		expect(providerProfilesEnvelopeSchema.parse(envelope)).toEqual(envelope)
	})

	it("rejects a record without the current schema version", () => {
		const flat = { currentApiConfigName: "a", apiConfigs: { a: { apiProvider: "openai" } } }
		expect(() => parseProviderProfilesEnvelope(flat)).toThrow("only version 2 is supported")
		expect(() => parseProviderProfilesEnvelope({ schemaVersion: 1, data: flat })).toThrow("schema version 1")
		expect(() => parseProviderProfilesEnvelope({ schemaVersion: 99, data: {} })).toThrow("schema version 99")
	})

	it("does not persist plaintext secrets", () => {
		const profile = createKnownPersistedProviderProfile({
			apiProvider: "anthropic",
			apiKey: "plaintext-secret",
			anthropicBaseUrl: "https://api.example",
		})
		expect(JSON.stringify(profile)).not.toContain("plaintext-secret")
	})
})

// R4: schema <-> ownership parity. For every KnownProviderId, the set of keys
// declared in `providerConfigSchemas[K].shape` must equal the set in
// `providerFieldOwnership[K]`, after excluding the shared-field list (which
// lives in the profile's `shared` section, not the per-provider config). This
// catches a future schema field that is forgotten in the ownership map (which
// would cause `pickPresent` to silently drop it during migration) and vice
// versa.
describe("providerConfigSchemas <-> providerFieldOwnership parity", () => {
	it.each([...activeProviderIds])(
		"%s: schema shape keys equal providerFieldOwnership keys (shared fields excluded)",
		(providerId) => {
			const schema = providerConfigSchemas[providerId as keyof typeof providerConfigSchemas]
			const ownership = providerFieldOwnership[providerId as keyof typeof providerFieldOwnership]
			expect(schema).toBeDefined()
			expect(ownership).toBeDefined()
			const schemaKeys = Object.keys(schema.shape).filter((k) => !SHARED_FIELD_NAMES.includes(k as never))
			const ownershipKeys = [...ownership]
			expect(schemaKeys.sort()).toEqual(ownershipKeys.sort())
		},
	)

	it("providerFieldOwnership has no keys for inactive providers that lack a schema", () => {
		const schemaKeys = new Set(Object.keys(providerConfigSchemas))
		const ownershipKeys = new Set(Object.keys(providerFieldOwnership))
		// Every ownership key must have a matching schema (ownership never
		// references a provider without a config schema).
		for (const key of ownershipKeys) {
			expect(schemaKeys.has(key)).toBe(true)
		}
	})
})
