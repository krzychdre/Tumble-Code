import { findCodeIndexProblems, resolveCodeIndexSettings } from "../code-index-settings.js"

/** The code index of a VS Code install, as the extension mirrors it. */
const vscode = {
	settings: {
		codebaseIndexConfig: {
			codebaseIndexEnabled: true,
			codebaseIndexQdrantUrl: "http://192.168.50.194:6333",
			codebaseIndexEmbedderProvider: "openai-compatible" as const,
			codebaseIndexOpenAiCompatibleBaseUrl: "http://192.168.50.194:11111/v1",
			codebaseIndexEmbedderModelId: "granite-embedding-311m-multilingual-r2",
			codebaseIndexEmbedderModelDimension: 768,
		},
	},
	codeIndexSecrets: { codebaseIndexOpenAiCompatibleApiKey: "vscode-key", codeIndexQdrantApiKey: "qdrant-key" },
}

describe("resolveCodeIndexSettings", () => {
	it("turns the index off without any source", () => {
		expect(resolveCodeIndexSettings({}, {})).toEqual({
			codeIndexSettings: {
				codebaseIndexEnabled: false,
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexQdrantUrl: "",
				codebaseIndexEmbedderModelId: "",
			},
			warnings: [],
		})
	})

	it("runs the editor's code index with its keys", () => {
		expect(resolveCodeIndexSettings({ vscode }, {}).codeIndexSettings).toEqual({
			...vscode.settings.codebaseIndexConfig,
			...vscode.codeIndexSecrets,
		})
	})

	it("takes each key of its own entry over the editor's, the key from its environment variable", () => {
		const { codeIndexSettings } = resolveCodeIndexSettings(
			{
				vscode,
				codeIndex: {
					qdrantUrl: "http://localhost:6333",
					model: "bge-m3",
					dimension: 1024,
					baseUrl: "http://other:8080/v1",
					apiKeyEnv: "EMBED_KEY",
				},
			},
			{ EMBED_KEY: "env-key" },
		)

		expect(codeIndexSettings).toMatchObject({
			codebaseIndexEnabled: true,
			codebaseIndexQdrantUrl: "http://localhost:6333",
			codeIndexQdrantApiKey: "qdrant-key",
			codebaseIndexEmbedderModelId: "bge-m3",
			codebaseIndexEmbedderModelDimension: 1024,
			codebaseIndexOpenAiCompatibleBaseUrl: "http://other:8080/v1",
			codebaseIndexOpenAiCompatibleApiKey: "env-key",
		})
	})

	it("an entry of its own turns the index on unless it says otherwise, and puts the server where its embedder reads it", () => {
		const entry = {
			embedder: "ollama" as const,
			baseUrl: "http://localhost:11434",
			qdrantUrl: "http://localhost:6333",
		}

		expect(resolveCodeIndexSettings({ codeIndex: entry }, {}).codeIndexSettings).toEqual({
			codebaseIndexEnabled: true,
			codebaseIndexEmbedderProvider: "ollama",
			codebaseIndexEmbedderBaseUrl: "http://localhost:11434",
			codebaseIndexQdrantUrl: "http://localhost:6333",
			codebaseIndexEmbedderModelId: "",
		})
		expect(
			resolveCodeIndexSettings({ codeIndex: { ...entry, enabled: false } }, {}).codeIndexSettings
				.codebaseIndexEnabled,
		).toBe(false)
	})

	it("warns about a key variable that is not set, and keeps the editor's key", () => {
		const { codeIndexSettings, warnings } = resolveCodeIndexSettings(
			{ vscode, codeIndex: { apiKeyEnv: "EMBED_KEY", qdrantApiKeyEnv: "QDRANT_KEY" } },
			{},
		)

		expect(warnings).toEqual([
			"codeIndex.qdrantApiKeyEnv names QDRANT_KEY, which is not set",
			"codeIndex.apiKeyEnv names EMBED_KEY, which is not set",
		])
		expect(codeIndexSettings.codebaseIndexOpenAiCompatibleApiKey).toBe("vscode-key")
	})
})

describe("findCodeIndexProblems", () => {
	it("accepts a complete entry and no entry", () => {
		expect(findCodeIndexProblems(undefined)).toEqual([])
		expect(
			findCodeIndexProblems({
				enabled: true,
				qdrantUrl: "http://localhost:6333",
				embedder: "openai-compatible",
				baseUrl: "http://localhost:8080/v1",
				model: "bge-m3",
				dimension: 1024,
				apiKeyEnv: "EMBED_KEY",
				searchMinScore: 0.4,
				searchMaxResults: 50,
			}),
		).toEqual([])
	})

	it.each([
		[{ embedder: "vercel-ai-gateway" }, "codeIndex.embedder must be one of:"],
		[{ enabled: "yes" }, "codeIndex.enabled must be true or false"],
		[{ qdrantUrl: "" }, "codeIndex.qdrantUrl must be a non-empty string"],
		[{ dimension: 1.5 }, "codeIndex.dimension must be a whole number greater than 0"],
		[{ searchMinScore: 2 }, "codeIndex.searchMinScore must be a number from 0 to 1"],
		[{ searchMaxResults: 5 }, "codeIndex.searchMaxResults must be a whole number from 10 to 200"],
		["on", "codeIndex must be an object"],
	])("names the problem in %j", (entry, problem) => {
		expect(findCodeIndexProblems(entry)).toEqual([expect.stringContaining(problem)])
	})
})
