import {
	activeProviderIds,
	getProviderApiKeyField,
	getProviderModelDefinition,
	providerRequiresApiKey,
	providerRequiresModelId,
	providerSettingsSchemaDiscriminated,
	providerValidationRegistry,
	SECRET_STATE_KEYS,
	type ProviderName,
} from "../index.js"

import { discriminatorMap } from "./helpers/discriminated-union.js"

const legacyArms = discriminatorMap(providerSettingsSchemaDiscriminated, "apiProvider")

// Providers whose secrets are a credential set resolved by a cloud SDK, not
// one API key (see providerApiKeyFields).
const CREDENTIAL_SET_PROVIDERS: readonly ProviderName[] = ["bedrock", "vertex"]

const secretFieldsOfArm = (provider: ProviderName): string[] => {
	const arm = legacyArms.get(provider)
	if (!arm) throw new Error(`No legacy arm for ${provider}`)
	return Object.keys(arm.shape).filter((field) => (SECRET_STATE_KEYS as readonly string[]).includes(field))
}

describe("provider API key fields", () => {
	it.each([...activeProviderIds])("%s: the API key field is the provider's one secret field", (provider) => {
		const secrets = secretFieldsOfArm(provider)
		const field = getProviderApiKeyField(provider)

		if (CREDENTIAL_SET_PROVIDERS.includes(provider)) {
			expect(field).toBeNull()
			expect(secrets.length).toBeGreaterThan(0)
		} else if (secrets.length === 0) {
			expect(field).toBeNull()
		} else {
			// Ollama was treated as keyless by the CLI although its settings
			// carry `ollamaApiKey`; a provider with one secret field names it.
			expect(secrets).toEqual([field])
		}
	})
})

describe("providerRequiresApiKey", () => {
	it("requires the key of every provider that has one, except Ollama", () => {
		for (const provider of activeProviderIds) {
			const expected = getProviderApiKeyField(provider) !== null && provider !== "ollama"
			expect({ provider, required: providerRequiresApiKey(provider) }).toEqual({ provider, required: expected })
		}
	})

	// These hosted APIs reject every request without a key; their handlers send
	// the placeholder "not-provided" when the profile has none.
	it.each(["deepseek", "moonshot", "minimax", "xai", "zai"] as const)("%s requires its API key", (provider) => {
		expect(providerRequiresApiKey(provider)).toBe(true)
	})

	it("keeps OAuth, local and SDK-credential providers keyless", () => {
		for (const provider of ["openai-codex", "qwen-code", "lmstudio", "bedrock", "vertex", "ollama"] as const) {
			expect(providerRequiresApiKey(provider)).toBe(false)
		}
	})
})

describe("providerRequiresModelId", () => {
	it.each([...activeProviderIds].filter((id) => id !== "vscode-lm"))(
		"%s: a model id is required exactly when there is no default model",
		(provider) => {
			expect(providerRequiresModelId(provider)).toBe(getProviderModelDefinition(provider)?.defaultModelId === "")
		},
	)

	it("every required field is a field of the provider's settings", () => {
		for (const provider of activeProviderIds) {
			const strategy = providerValidationRegistry[provider]
			if (strategy.kind !== "required-fields") continue
			const arm = legacyArms.get(provider)!
			for (const field of strategy.fields) {
				expect(Object.keys(arm.shape)).toContain(field)
			}
		}
	})
})
