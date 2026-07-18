import { modelSourceRequestSchema, modelSourceResultSchema, modelSourceSchema, modelSources } from "../model-source.js"

describe("ModelSource", () => {
	it("round-trips every portable source descriptor", () => {
		expect(modelSourceSchema.parse({ kind: "static" })).toEqual({ kind: "static" })
		for (const source of Object.values(modelSources)) {
			expect(modelSourceSchema.parse(JSON.parse(JSON.stringify(source)))).toEqual(source)
		}
	})

	it("validates correlated requests and results", () => {
		expect(
			modelSourceRequestSchema.parse({
				requestId: "request-1",
				source: modelSources.ollama,
				options: { baseUrl: "http://localhost:11434" },
			}),
		).toEqual({
			requestId: "request-1",
			source: modelSources.ollama,
			options: { baseUrl: "http://localhost:11434" },
		})

		expect(
			modelSourceResultSchema.parse({ requestId: "request-1", sourceId: "ollama", modelIds: ["qwen"] }),
		).toEqual({ requestId: "request-1", sourceId: "ollama", modelIds: ["qwen"] })
	})

	it("rejects unknown sources and uncorrelated payloads", () => {
		expect(modelSourceSchema.safeParse({ id: "unknown", kind: "remote" }).success).toBe(false)
		expect(modelSourceRequestSchema.safeParse({ source: modelSources.openrouter }).success).toBe(false)
		expect(modelSourceResultSchema.safeParse({ requestId: "", sourceId: "ollama" }).success).toBe(false)
	})
})
