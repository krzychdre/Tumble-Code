import { z } from "zod"

import {
	activeProviderIds,
	type KnownProviderId,
	persistedProviderProfileSchema,
	providerConfigSchemas,
	providerProfileToLegacySettings,
	providerSettingsSchema,
	providerSettingsSchemaDiscriminated,
	SECRET_STATE_KEYS,
} from "../index.js"

import { discriminatorMap } from "./helpers/discriminated-union.js"

// The legacy flat arms of `providerSettingsSchemaDiscriminated` carry three
// groups of fields: the shared profile settings, the provider's own config
// (the persisted `providerConfigSchemas[id]`) and the provider's credentials,
// which live in the secret store and are deliberately absent from the
// persisted config. Only the credentials may differ between an arm and its
// config; everything else has to be the same list.
const LEGACY_SHARED_FIELDS = [
	"includeMaxTokens",
	"todoListEnabled",
	"modelTemperature",
	"rateLimitSeconds",
	"consecutiveMistakeLimit",
	"slimToolset",
	"slimHidesMcp",
	"enableReasoningEffort",
	"reasoningEffort",
	"modelMaxTokens",
	"modelMaxThinkingTokens",
	"verbosity",
]

const CREDENTIAL_FIELDS: Record<KnownProviderId, readonly string[]> = {
	anthropic: ["apiKey"],
	openrouter: ["openRouterApiKey"],
	bedrock: ["awsAccessKey", "awsSecretKey", "awsSessionToken", "awsApiKey"],
	vertex: ["vertexJsonCredentials"],
	openai: ["openAiApiKey"],
	ollama: ["ollamaApiKey"],
	"vscode-lm": [],
	lmstudio: [],
	gemini: ["geminiApiKey"],
	"gemini-cli": [],
	"openai-codex": [],
	"openai-native": ["openAiNativeApiKey"],
	mistral: ["mistralApiKey"],
	deepseek: ["deepSeekApiKey"],
	moonshot: ["moonshotApiKey"],
	minimax: ["minimaxApiKey"],
	"fake-ai": [],
	xai: ["xaiApiKey"],
	litellm: ["litellmApiKey"],
	zai: ["zaiApiKey"],
	"qwen-code": [],
}

const legacyArms = discriminatorMap(providerSettingsSchemaDiscriminated, "apiProvider")

const legacyArm = (providerId: KnownProviderId): z.ZodObject => {
	const arm = legacyArms.get(providerId)
	if (!arm) throw new Error(`No legacy arm for ${providerId}`)
	return arm
}

// A JSON rendering of a schema that ignores property order, so a schema built
// in a different order but accepting the same values compares equal.
const sortKeysDeep = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sortKeysDeep)
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sortKeysDeep((value as Record<string, unknown>)[key])]),
		)
	}
	return value
}

const describeSchema = (schema: z.ZodType) => sortKeysDeep(z.toJSONSchema(schema, { reused: "inline" }))

describe("legacy provider settings arms against the provider config schemas", () => {
	it("has one legacy arm per active provider", () => {
		for (const providerId of activeProviderIds) {
			expect(legacyArm(providerId)).toBeDefined()
		}
	})

	it.each([...activeProviderIds])("%s: arm fields minus shared and credential fields equal the config", (id) => {
		const armFields = Object.keys(legacyArm(id).shape).filter(
			(field) =>
				field !== "apiProvider" &&
				!LEGACY_SHARED_FIELDS.includes(field) &&
				!CREDENTIAL_FIELDS[id].includes(field),
		)
		const configFields = Object.keys(providerConfigSchemas[id].shape)
		expect(armFields.sort()).toEqual(configFields.sort())
	})

	it.each([...activeProviderIds])("%s: every credential field of the arm exists", (id) => {
		const armFields = Object.keys(legacyArm(id).shape)
		for (const field of CREDENTIAL_FIELDS[id]) {
			expect(armFields).toContain(field)
		}
	})

	it("stores every credential field in the secret store", () => {
		const credentials = Object.values(CREDENTIAL_FIELDS).flat()
		for (const field of credentials) {
			expect(SECRET_STATE_KEYS as readonly string[]).toContain(field)
		}
	})

	it.each([...activeProviderIds])("%s: shared config fields keep their config types in the arm", (id) => {
		const arm = legacyArm(id)
		for (const [field, schema] of Object.entries(providerConfigSchemas[id].shape)) {
			if (!(field in arm.shape)) continue
			expect(describeSchema(arm.shape[field])).toEqual(describeSchema(schema as z.ZodType))
		}
	})
})

describe("openai apiModelId", () => {
	// The settings UI mirrors the selected model id into `apiModelId` for every
	// provider (ApiOptions.tsx), and the openai config owns `apiModelId`, so a
	// stored openai profile carries it next to `openAiModelId`.
	const storedOpenAiProfile = {
		id: "openai-id",
		provider: {
			providerId: "openai",
			config: { openAiBaseUrl: "https://llm.example/v1", openAiModelId: "qwen3", apiModelId: "qwen3" },
		},
		shared: { modelTemperature: 0 },
	}

	it("is a valid field of a stored openai profile", () => {
		expect(persistedProviderProfileSchema.safeParse(storedOpenAiProfile).success).toBe(true)
	})

	it("survives the legacy openai arm like every other config field", () => {
		const profile = persistedProviderProfileSchema.parse(storedOpenAiProfile)
		const legacy = providerSettingsSchemaDiscriminated.parse(providerProfileToLegacySettings(profile))
		expect(legacy).toEqual({
			apiProvider: "openai",
			openAiBaseUrl: "https://llm.example/v1",
			openAiModelId: "qwen3",
			apiModelId: "qwen3",
			modelTemperature: 0,
		})
	})
})

describe("flat provider settings schema (must not change)", () => {
	it("keeps the same fields and field types", () => {
		expect(describeSchema(providerSettingsSchema)).toMatchSnapshot()
	})
})
