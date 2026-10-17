// npx vitest run src/api/providers/__tests__/vertex-model-family-characterization.spec.ts

// For every model id in the Vertex table: the handler of its family runs it, under its own id and its own
// table record, and the registry and the settings UI resolve it to the same id. A full snapshot of
// getModel() proved the model-family refactor changed nothing for known ids
// (ai_plans/2026-10-17_12-48_vertex-model-family.md); this keeps the rule without pinning every price.

import { type ProviderSettings, resolveProviderModelSelection, vertexModels } from "@tumble-code/types"

import { runtimeProviderRegistry } from "../../runtime-provider-registry"

const entry = runtimeProviderRegistry.vertex

describe("Vertex known model ids", () => {
	it.each(Object.keys(vertexModels))("%s runs on its family's handler with its own record", (apiModelId) => {
		const settings: ProviderSettings = { vertexProjectId: "test-project", vertexRegion: "us-central1", apiModelId }
		const handler = entry.factory(settings)
		const { id, info } = handler.getModel()
		const record = vertexModels[apiModelId as keyof typeof vertexModels]

		expect(handler.constructor.name).toBe(
			apiModelId.startsWith("claude") ? "AnthropicVertexHandler" : "VertexHandler",
		)
		// The Gemini handler and the registry report a `:thinking` variant under the base id it is sent as.
		const sentId = apiModelId.replace(/:thinking$/, "")
		expect(id).toBe(sentId)
		expect(info.inputPrice).toBe(record.inputPrice)
		expect(info.contextWindow).toBe(record.contextWindow)
		expect(entry.resolveModel(settings)?.id).toBe(sentId)
		expect(
			resolveProviderModelSelection({ ...settings, apiProvider: "vertex" }, { emptyModelId: "keep-empty" })?.id,
		).toBe(apiModelId)
	})
})
