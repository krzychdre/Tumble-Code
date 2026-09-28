import {
	PROVIDER_DESCRIPTORS,
	getDescriptorFormProviderIds,
	getProviderDescriptor,
	resolveProviderGetKeyUrl,
	type ProviderDescriptor,
	type ProviderFieldDescriptor,
} from "../provider-descriptors.js"
import { activeProviderIds, getSelectableProviderDefinitions } from "../provider-registry.js"
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
			"deepseek",
			"gemini",
			"minimax",
			"moonshot",
			"xai",
			"zai",
		])
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
