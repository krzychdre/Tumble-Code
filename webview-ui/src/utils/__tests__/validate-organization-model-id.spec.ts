import {
	getModelIdKeyForProvider,
	providerNames,
	type OrganizationAllowList,
	type ProviderName,
	type ProviderSettings,
} from "@roo-code/types"

vi.mock("i18next", () => ({ default: { t: (key: string) => key } }))

import { getModelValidationError } from "../validate"

// DEF-C15: the settings validation must check the organization allow list
// against the field that holds each provider's model (openai-native keeps it in
// apiModelId, OpenAI Compatible in openAiModelId). Reading an empty field let a
// forbidden model pass silently.

const MODEL = "c15-model"

const settingsWithModel = (provider: ProviderName, modelId: string): ProviderSettings => {
	if (provider === "vscode-lm") {
		return { apiProvider: provider, vsCodeLmModelSelector: { id: modelId } }
	}

	return { apiProvider: provider, [getModelIdKeyForProvider(provider)!]: modelId }
}

const allowListFor = (provider: ProviderName, models: string[]): OrganizationAllowList => ({
	allowAll: false,
	providers: { [provider]: { allowAll: false, models } },
})

// fake-ai has no model id in settings.
const providersWithModelId = [...new Set(providerNames)].filter((provider) => provider !== "fake-ai")

describe("organization allow list model check", () => {
	it.each(providersWithModelId)("accepts an allowed %s model", (provider) => {
		expect(
			getModelValidationError(settingsWithModel(provider, MODEL), undefined, allowListFor(provider, [MODEL])),
		).toBeUndefined()
	})

	it.each(providersWithModelId)("rejects a forbidden %s model", (provider) => {
		expect(
			getModelValidationError(settingsWithModel(provider, MODEL), undefined, allowListFor(provider, ["other"])),
		).toBe("settings:validation.modelNotAllowed")
	})

	// ApiOptions writes the openai-native model to apiModelId, and the handler reads it from there.
	it("rejects a forbidden openai-native model stored in apiModelId", () => {
		expect(
			getModelValidationError(
				{ apiProvider: "openai-native", apiModelId: MODEL },
				undefined,
				allowListFor("openai-native", ["other"]),
			),
		).toBe("settings:validation.modelNotAllowed")
	})
})
