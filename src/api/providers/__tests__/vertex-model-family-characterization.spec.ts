// npx vitest run src/api/providers/__tests__/vertex-model-family-characterization.spec.ts

// Pins, for every model id in the Vertex table, which handler runs it and what that handler's getModel()
// reports, plus what the registry and the settings UI resolve it to. The snapshot was generated on main
// before the model-family refactor (ai_plans/2026-10-17_12-48_vertex-model-family.md), so a known id must
// keep this exact behaviour.

import { type ProviderSettings, resolveProviderModelSelection, vertexModels } from "@tumble-code/types"

import { runtimeProviderRegistry } from "../../runtime-provider-registry"

const settingsVariants: Record<string, Partial<ProviderSettings>> = {
	plain: {},
	"1M, reasoning effort high": { vertex1MContext: true, enableReasoningEffort: true, reasoningEffort: "high" },
}

const entry = runtimeProviderRegistry.vertex

describe("Vertex known model ids (characterization)", () => {
	describe.each(Object.entries(settingsVariants))("%s", (_variant, variant) => {
		it.each(Object.keys(vertexModels))("%s", (apiModelId) => {
			const settings = { vertexProjectId: "test-project", vertexRegion: "us-central1", ...variant, apiModelId }
			const handler = entry.factory(settings)

			expect({
				handler: handler.constructor.name,
				getModel: handler.getModel(),
				resolveModel: entry.resolveModel(settings),
				settingsUi: resolveProviderModelSelection(
					{ ...settings, apiProvider: "vertex" },
					{ emptyModelId: "keep-empty" },
				),
			}).toMatchSnapshot()
		})
	})
})
