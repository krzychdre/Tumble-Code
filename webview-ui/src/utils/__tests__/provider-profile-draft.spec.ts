import { providerEditDraftToProfile, providerProfileToEditDraft } from "../provider-profile-draft"
import type { OpaqueProviderProfile } from "@roo-code/types"

describe("provider profile edit drafts", () => {
	it("isolates provider fields when switching providers", () => {
		const openAi = providerEditDraftToProfile({
			apiProvider: "openai",
			openAiBaseUrl: "https://openai.example",
			openAiModelId: "must-not-leak",
		})
		const switched = providerEditDraftToProfile({
			...providerProfileToEditDraft(openAi),
			apiProvider: "anthropic",
			anthropicBaseUrl: "https://anthropic.example",
		})

		expect(providerProfileToEditDraft(switched)).toEqual({
			apiProvider: "anthropic",
			anthropicBaseUrl: "https://anthropic.example",
		})
	})

	it("returns a safe legacy shape for opaque retired/unknown profiles without throwing (M2)", () => {
		// A retired provider (groq) is persisted as an opaque tombstone. The
		// edit-draft helper must NOT delegate to `providerProfileToLegacySettings`
		// (which throws for unavailable providers); instead it spreads the
		// `opaqueLegacyPayload` directly so SettingsView can load it safely.
		const opaqueProfile: OpaqueProviderProfile = {
			id: "retired-id",
			provider: {
				providerId: "groq",
				opaqueLegacyPayload: {
					apiProvider: "groq",
					apiModelId: "legacy-model",
					openAiBaseUrl: "https://legacy.example/v1",
					// Legacy provider-specific field preserved via passthrough.
					groqApiKey: "legacy-groq-key",
				},
			},
		}

		const draft = providerProfileToEditDraft(opaqueProfile)

		expect(draft).toEqual({
			apiProvider: "groq",
			apiModelId: "legacy-model",
			openAiBaseUrl: "https://legacy.example/v1",
			groqApiKey: "legacy-groq-key",
		})
		// Round-tripping the draft back into a known profile is not expected for
		// opaque profiles (createKnownPersistedProviderProfile would throw),
		// so we only assert the read direction here.
		expect(draft.apiProvider).toBe("groq")
	})
})
