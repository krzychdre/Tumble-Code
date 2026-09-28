import { z } from "zod"

import {
	GLOBAL_STATE_KEYS,
	isSecretStateKey,
	knownProviderConfigurationSchema,
	PROVIDER_SETTINGS_KEYS,
	providerSettingsSchema,
	providerSettingsSchemaDiscriminated,
	SECRET_STATE_KEYS,
} from "../index.js"

// The provider settings schemas (the legacy flat schema, its discriminated arms, the persisted
// configuration union) and the secret key list are generated from the per-provider tables
// (`providerConfigSchemas`, `providerCredentialFields`). These snapshots pin what they produce,
// property order included: adding a provider changes them (update with `-u` and review the diff),
// anything else must not.

// `z.undefined()` (the arm for a profile without a provider) has no JSON Schema form.
const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { reused: "inline", unrepresentable: "any" })

describe("generated provider settings schemas", () => {
	it("keeps the flat schema's keys in order", () => {
		expect(PROVIDER_SETTINGS_KEYS).toMatchSnapshot()
	})

	it("keeps the flat schema, property order included", () => {
		expect(jsonSchema(providerSettingsSchema)).toMatchSnapshot()
	})

	it("keeps the discriminated legacy arms, in order", () => {
		expect(jsonSchema(providerSettingsSchemaDiscriminated)).toMatchSnapshot()
	})

	it("keeps the persisted provider configuration union, in order", () => {
		expect(jsonSchema(knownProviderConfigurationSchema)).toMatchSnapshot()
	})

	it("keeps the global state keys in order", () => {
		expect(GLOBAL_STATE_KEYS).toMatchSnapshot()
	})
})

describe("secret state keys", () => {
	it("lists the same keys (order is not significant: readers and writers visit each once)", () => {
		expect([...SECRET_STATE_KEYS].sort()).toMatchSnapshot()
		expect(new Set(SECRET_STATE_KEYS).size).toBe(SECRET_STATE_KEYS.length)
	})

	it("recognises exactly those keys among the provider settings", () => {
		expect(PROVIDER_SETTINGS_KEYS.filter((key) => isSecretStateKey(key)).sort()).toEqual(
			[...SECRET_STATE_KEYS].sort(),
		)
	})
})
