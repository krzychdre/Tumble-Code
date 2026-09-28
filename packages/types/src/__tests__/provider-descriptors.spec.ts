import {
	PROVIDER_DESCRIPTORS,
	getDescriptorFormProviderIds,
	getInFormModelPickerProviderIds,
	getProviderDescriptor,
	matchesProviderModelRule,
	resolveProviderFormModelId,
	resolveProviderGetKeyUrl,
	resolveProviderModelSourceOptions,
	type ProviderDescriptor,
	type ProviderFieldDescriptor,
} from "../provider-descriptors.js"
import { providerModelDefinitions } from "../provider-models.js"
import { activeProviderIds, getProviderDefinition, getSelectableProviderDefinitions } from "../provider-registry.js"
import type { ProviderSettings } from "../provider-settings.js"
import { providerApiKeyFields } from "../provider-validation.js"

const entries = Object.entries(PROVIDER_DESCRIPTORS) as [keyof typeof PROVIDER_DESCRIPTORS, ProviderDescriptor][]

const fieldsOf = (descriptor: ProviderDescriptor): readonly ProviderFieldDescriptor[] =>
	descriptor.form.kind === "fields" ? descriptor.form.fields : []

describe("PROVIDER_DESCRIPTORS", () => {
	it("has exactly one row per executable (active or hidden) provider", () => {
		expect(Object.keys(PROVIDER_DESCRIPTORS).sort()).toEqual([...activeProviderIds].sort())
	})

	it("gives every selectable provider a docs page and every hidden provider no form", () => {
		const selectable = new Set<string>(getSelectableProviderDefinitions().map(({ id }) => id))

		for (const [provider, descriptor] of entries) {
			if (selectable.has(provider)) {
				expect(descriptor.docsSlug, provider).toMatch(/^[a-z0-9-]+$/)
				expect(descriptor.form.kind, provider).not.toBe("none")
			} else {
				expect(descriptor.form.kind, provider).toBe("none")
			}
		}
	})

	it("uses an apiKey field only where providerApiKeyFields names the key", () => {
		for (const [provider, descriptor] of entries) {
			if (fieldsOf(descriptor).some((field) => field.kind === "apiKey")) {
				expect(providerApiKeyFields[provider], provider).not.toBeNull()
			}
		}
	})

	it("keeps select defaults and endpoint-dependent key links inside the option lists", () => {
		for (const [provider, descriptor] of entries) {
			const fields = fieldsOf(descriptor)

			for (const field of fields) {
				if (field.kind === "select") {
					const values = field.options.map(({ value }) => value)
					expect(new Set(values).size, provider).toBe(values.length)
					if (field.defaultValue !== undefined) {
						expect(values, provider).toContain(field.defaultValue)
					}
				}

				if (field.kind === "apiKey" && typeof field.getKeyUrl !== "string") {
					const { field: key, byValue } = field.getKeyUrl
					const select = fields.find((other) => other.kind === "select" && other.key === key)
					expect(select, `${provider}: getKeyUrl reads a field the form does not render`).toBeDefined()
					const values = select?.kind === "select" ? select.options.map(({ value }) => value) : []
					expect(values, provider).toEqual(expect.arrayContaining(Object.keys(byValue)))
				}
			}
		}
	})

	it("lists the generic-form providers", () => {
		expect(getDescriptorFormProviderIds().sort()).toEqual([
			"anthropic",
			"deepseek",
			"gemini",
			"minimax",
			"mistral",
			"moonshot",
			"xai",
			"zai",
		])
	})

	it("uses model rules only on providers whose model id comes from a static list", () => {
		for (const [provider, descriptor] of entries) {
			if (fieldsOf(descriptor).some((field) => field.visibleWhen)) {
				const definition = providerModelDefinitions[provider]
				expect("models" in definition && definition.modelIdField === "apiModelId", provider).toBe(true)
			}
		}
	})

	it("gives fetched-list request options only to providers with a fetched model list", () => {
		for (const [provider, descriptor] of entries) {
			if (descriptor.modelSourceOptions) {
				const definition = getProviderDefinition(provider)
				expect(definition && "modelSource" in definition && definition.modelSource, provider).toBeTruthy()
			}
		}
	})

	it("builds the Z.ai line options from zaiApiLineConfigs", () => {
		const [line] = fieldsOf(PROVIDER_DESCRIPTORS.zai)
		expect(line).toMatchObject({ kind: "select", key: "zaiApiLine", defaultValue: "international_coding" })
		expect(line?.kind === "select" && line.options).toEqual([
			{ value: "international_coding", label: "International Coding (https://api.z.ai/api/coding/paas/v4)" },
			{ value: "china_coding", label: "China Coding (https://open.bigmodel.cn/api/coding/paas/v4)" },
			{ value: "international_api", label: "International API (https://api.z.ai/api/paas/v4)" },
			{ value: "china_api", label: "China API (https://open.bigmodel.cn/api/paas/v4)" },
		])
	})

	it("rejects an apiKey field for a provider without an API key settings key (compile time)", () => {
		const lmStudioWithKey = {
			form: {
				kind: "fields",
				// @ts-expect-error lmstudio has no API key field in providerApiKeyFields.
				fields: [{ kind: "apiKey", labelKey: "x", getKeyUrl: "https://x", getKeyLabelKey: "y" }],
			},
		} satisfies ProviderDescriptor<"lmstudio">
		expect(lmStudioWithKey.form.kind).toBe("fields")
	})
})

describe("getProviderDescriptor", () => {
	it("returns the row of a known provider and nothing for retired or unknown ids", () => {
		expect(getProviderDescriptor("xai")).toBe(PROVIDER_DESCRIPTORS.xai)
		expect(getProviderDescriptor("groq")).toBeUndefined()
		expect(getProviderDescriptor("toString")).toBeUndefined()
		expect(getProviderDescriptor(undefined)).toBeUndefined()
	})
})

describe("resolveProviderFormModelId", () => {
	it("returns the configured id, or the provider default for an unset or empty id", () => {
		expect(resolveProviderFormModelId("mistral", { apiModelId: "mistral-large-latest" })).toBe(
			"mistral-large-latest",
		)
		expect(resolveProviderFormModelId("mistral", {})).toBe(providerModelDefinitions.mistral.defaultModelId)
		expect(resolveProviderFormModelId("mistral", { apiModelId: "" })).toBe(
			providerModelDefinitions.mistral.defaultModelId,
		)
	})

	it("reads the provider's own model id field and handles providers without one", () => {
		expect(resolveProviderFormModelId("ollama", { apiModelId: "a", ollamaModelId: "llama3" })).toBe("llama3")
		expect(resolveProviderFormModelId("ollama", { apiModelId: "a" })).toBe("")
		expect(resolveProviderFormModelId("vscode-lm", { apiModelId: "a" })).toBe(
			providerModelDefinitions["vscode-lm"].defaultModelId,
		)
		expect(resolveProviderFormModelId("groq", { apiModelId: "a" })).toBe("")
	})
})

describe("matchesProviderModelRule", () => {
	it("matches a prefix or a list of ids", () => {
		expect(matchesProviderModelRule({ modelIdStartsWith: "codestral-" }, "codestral-latest")).toBe(true)
		expect(matchesProviderModelRule({ modelIdStartsWith: "codestral-" }, "my-codestral-latest")).toBe(false)
		expect(matchesProviderModelRule({ modelIdIn: ["a", "b"] }, "b")).toBe(true)
		expect(matchesProviderModelRule({ modelIdIn: ["a", "b"] }, "c")).toBe(false)
	})
})

describe("getInFormModelPickerProviderIds", () => {
	it("lists the providers whose form selects the model", () => {
		expect(getInFormModelPickerProviderIds().sort()).toEqual([
			"litellm",
			"lmstudio",
			"ollama",
			"openai",
			"openai-codex",
			"openrouter",
			"vscode-lm",
		])
	})
})

describe("resolveProviderModelSourceOptions", () => {
	it("reads the keys the provider's row names and nothing for other providers", () => {
		expect(
			resolveProviderModelSourceOptions({
				apiProvider: "openai",
				openAiBaseUrl: "https://b",
				openAiApiKey: "k",
				openAiHeaders: { a: "b" },
				ollamaBaseUrl: "https://o",
			}),
		).toStrictEqual({ baseUrl: "https://b", apiKey: "k", headers: { a: "b" } })
		expect(resolveProviderModelSourceOptions({ apiProvider: "lmstudio" })).toStrictEqual({ baseUrl: undefined })
		expect(resolveProviderModelSourceOptions({ apiProvider: "anthropic", apiKey: "k" })).toStrictEqual({})
		expect(resolveProviderModelSourceOptions({})).toStrictEqual({})
	})
})

describe("resolveProviderGetKeyUrl", () => {
	const byEndpoint = {
		field: "moonshotBaseUrl",
		byValue: { "https://api.moonshot.cn/v1": "https://cn.example/keys" },
		otherwise: "https://global.example/keys",
	} as const

	// A stored value the schema would not produce (an old or hand-edited profile).
	const unlisted = (moonshotBaseUrl: string) => ({ moonshotBaseUrl }) as unknown as ProviderSettings

	it("returns a fixed URL as is", () => {
		expect(resolveProviderGetKeyUrl("https://fixed.example", {})).toBe("https://fixed.example")
	})

	it("follows the setting it depends on, falling back for unset and unlisted values", () => {
		expect(resolveProviderGetKeyUrl(byEndpoint, { moonshotBaseUrl: "https://api.moonshot.cn/v1" })).toBe(
			"https://cn.example/keys",
		)
		expect(resolveProviderGetKeyUrl(byEndpoint, {})).toBe("https://global.example/keys")
		expect(resolveProviderGetKeyUrl(byEndpoint, unlisted("https://elsewhere/v1"))).toBe(
			"https://global.example/keys",
		)
		expect(resolveProviderGetKeyUrl(byEndpoint, unlisted("constructor"))).toBe("https://global.example/keys")
	})
})
