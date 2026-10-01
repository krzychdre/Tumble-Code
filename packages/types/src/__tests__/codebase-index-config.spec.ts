import { globalSettingsSchema } from "../index.js"

// Vercel AI Gateway was removed as a code index embedder. Settings saved with it must still parse
// (export and import go through this schema); only the removed provider reads as unset.
describe("codebaseIndexConfig with a removed embedder provider", () => {
	it("parses, with the provider unset and the other fields kept", () => {
		const result = globalSettingsSchema.safeParse({
			codebaseIndexConfig: {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "vercel-ai-gateway",
				codebaseIndexEmbedderModelId: "openai/text-embedding-3-small",
			},
		})

		expect(result.success).toBe(true)
		expect(result.data?.codebaseIndexConfig).toEqual({
			codebaseIndexEnabled: true,
			codebaseIndexQdrantUrl: "http://qdrant.local",
			codebaseIndexEmbedderProvider: undefined,
			codebaseIndexEmbedderModelId: "openai/text-embedding-3-small",
		})
	})

	it("keeps an available provider", () => {
		const result = globalSettingsSchema.parse({ codebaseIndexConfig: { codebaseIndexEmbedderProvider: "mistral" } })
		expect(result.codebaseIndexConfig?.codebaseIndexEmbedderProvider).toBe("mistral")
	})
})
