import { describe, it, expect } from "vitest"

import { getProviderDefaultModelId } from "../providers/index.js"
import { openAiNativeDefaultModelId, openAiNativeModels } from "../providers/openai.js"

describe("getProviderDefaultModelId", () => {
	// The webview shows this id for a fresh OpenAI profile while the handler
	// falls back to openAiNativeDefaultModelId, so the two must agree and the id
	// must exist in the model table (the old literal "gpt-4o" did not).
	it("returns the canonical OpenAI Native default model", () => {
		const id = getProviderDefaultModelId("openai-native")

		expect(id).toBe(openAiNativeDefaultModelId)
		expect(openAiNativeModels).toHaveProperty(id)
	})
})
