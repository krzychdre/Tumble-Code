// Which text reaches the embedding backend for indexing and for search.
//
// Some embedding models are asymmetric: a query gets an instruction prefix, a document (indexed
// code) does not. nomic-embed-code is one of them; its model card embeds queries as
// "Represent this query for searching relevant code: <query>" and code snippets as they are.
// The indexing callers (DirectoryScanner.processBatch, FileWatcher.processFile) call
// createEmbeddings(texts); the search service (CodebaseSearchTool -> CodeIndexSearchService)
// embeds the query. This spec runs the real BaseHttpEmbedder and the real search service and
// records the texts handed to the backend.

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() }, hasInstance: () => false },
}))

vi.mock("../../../../i18n", () => ({
	t: (key: string) => key,
}))

import type { EmbedderProvider } from "@roo-code/types"

import { BaseHttpEmbedder, EmbedBatchResult } from "../base-http-embedder"
import type { EmbedderInfo } from "../../interfaces/embedder"
import type { IVectorStore } from "../../interfaces/vector-store"
import { CodeIndexSearchService } from "../../search-service"
import { getModelQueryPrefix } from "../../../../shared/embeddingModels"

const NOMIC_CODE_QUERY_PREFIX = "Represent this query for searching relevant code: "

class RecordingEmbedder extends BaseHttpEmbedder {
	readonly requests: string[][] = []

	constructor(provider: EmbedderProvider, modelId: string, maxItemTokens?: number) {
		super({ defaultModelId: modelId, queryPrefixProvider: provider, rateLimitKey: `rec-${provider}`, maxItemTokens })
	}

	get embedderInfo(): EmbedderInfo {
		return { name: "openai-compatible" }
	}

	protected get telemetryName(): string {
		return "RecordingEmbedder"
	}

	protected async embedBatch(texts: string[]): Promise<EmbedBatchResult> {
		this.requests.push(texts)
		return { embeddings: texts.map(() => [1, 0, 0]) }
	}
}

function searchServiceFor(embedder: RecordingEmbedder) {
	const configManager = {
		isFeatureEnabled: true,
		isFeatureConfigured: true,
		currentSearchMinScore: 0.1,
		currentSearchMaxResults: 5,
	}
	const stateManager = {
		getCurrentStatus: () => ({ systemStatus: "Indexed" }),
		setSystemState: vi.fn(),
	}
	const vectorStore = { search: vi.fn().mockResolvedValue([]) } as unknown as IVectorStore
	return new CodeIndexSearchService(configManager as any, stateManager as any, embedder, vectorStore)
}

describe("query prefix routing (asymmetric embedding models)", () => {
	it("the profile table knows the nomic-embed-code query prefix for both providers that list it", () => {
		expect(getModelQueryPrefix("ollama", "nomic-embed-code")).toBe(NOMIC_CODE_QUERY_PREFIX)
		expect(getModelQueryPrefix("openai-compatible", "nomic-embed-code")).toBe(NOMIC_CODE_QUERY_PREFIX)
	})

	describe.each<EmbedderProvider>(["ollama", "openai-compatible"])("nomic-embed-code via %s", (provider) => {
		it("indexing: code chunks embedded the way the scanner and the file watcher call it get NO prefix", async () => {
			const embedder = new RecordingEmbedder(provider, "nomic-embed-code")

			// scanner.ts processBatch and file-watcher.ts processFile: createEmbeddings(texts)
			await embedder.createEmbeddings(["function add(a, b) { return a + b }", "class Foo {}"])

			expect(embedder.requests).toEqual([["function add(a, b) { return a + b }", "class Foo {}"]])
		})

		it("search: the query sent by the search service carries the query prefix", async () => {
			const embedder = new RecordingEmbedder(provider, "nomic-embed-code")

			await searchServiceFor(embedder).searchIndex("where are numbers added")

			expect(embedder.requests).toEqual([[`${NOMIC_CODE_QUERY_PREFIX}where are numbers added`]])
		})

		it("search: a query that already starts with the prefix is not prefixed twice", async () => {
			const embedder = new RecordingEmbedder(provider, "nomic-embed-code")

			await searchServiceFor(embedder).searchIndex(`${NOMIC_CODE_QUERY_PREFIX}add numbers`)

			expect(embedder.requests).toEqual([[`${NOMIC_CODE_QUERY_PREFIX}add numbers`]])
		})
	})

	it("search: a query too long for the item limit with the prefix is sent without it (then cut)", async () => {
		const embedder = new RecordingEmbedder("openai-compatible", "nomic-embed-code", 10)
		const query = "q".repeat(40) // exactly 10 estimated tokens, the prefix would push it over

		await searchServiceFor(embedder).searchIndex(query)

		expect(embedder.requests).toEqual([[query]])
	})

	// Models without a profile prefix: the owner's llama-swap ids (qwen3-embed, bge-m3, granite...)
	// and every hosted model in the table. Nothing is added in either direction, before and after.
	describe.each<[EmbedderProvider, string]>([
		["openai-compatible", "qwen3-embed"],
		["openai-compatible", "bge-m3"],
		["openai-compatible", "text-embedding-3-small"],
		["openrouter", "qwen/qwen3-embedding-8b"],
		["ollama", "nomic-embed-text"],
	])("%s / %s (no profile prefix)", (provider, modelId) => {
		it("sends documents and queries unchanged", async () => {
			const embedder = new RecordingEmbedder(provider, modelId)

			await embedder.createEmbeddings(["const x = 1"])
			await searchServiceFor(embedder).searchIndex("find x")

			expect(embedder.requests).toEqual([["const x = 1"], ["find x"]])
		})
	})
})
