import { createKnownPersistedProviderProfile } from "@roo-code/types"

import { resolveProviderProfileRuntimeOptions } from "../provider-profile-runtime"
import { runtimeProviderRegistry } from "../runtime-provider-registry"

describe("resolveProviderProfileRuntimeOptions", () => {
	it.each(Object.keys(runtimeProviderRegistry) as Array<keyof typeof runtimeProviderRegistry>)(
		"resolves %s without leaking another provider's fields",
		(providerId) => {
			const profile = createKnownPersistedProviderProfile({
				apiProvider: providerId,
				apiModelId: "model",
				openAiBaseUrl: "https://openai.example",
			})
			const options = resolveProviderProfileRuntimeOptions(profile, { apiKey: "secret" })

			expect(options.apiKey).toBe("secret")
			if (providerId !== "openai") expect(options.openAiBaseUrl).toBeUndefined()
		},
	)

	it("rejects opaque retired profiles before runtime construction", () => {
		expect(() =>
			resolveProviderProfileRuntimeOptions({
				provider: { providerId: "glama", opaqueLegacyPayload: { apiProvider: "glama", future: true } },
			}),
		).toThrow("unavailable")
	})
})
