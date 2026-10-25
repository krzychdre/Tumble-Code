// CodeIndexServiceFactory on the real config manager and model table; the settings store and the
// Qdrant store (the database boundary) are replaced. Which embedder class each provider builds is
// pinned in embedder-config.characterization.spec.ts.

vi.mock("../vector-store/qdrant-client", () => ({ QdrantVectorStore: vi.fn() }))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() } },
}))

vi.mock("../../../i18n", () => ({
	t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}))

import * as vscode from "vscode"
import { TelemetryService } from "@tumble-code/telemetry"

import { CodeIndexServiceFactory } from "../service-factory"
import { CodeIndexConfigManager } from "../config-manager"
import { QdrantVectorStore } from "../vector-store/qdrant-client"
import { DirectoryScanner, FileWatcher } from "../processors"
import type { IEmbedder } from "../interfaces"
import { logger } from "../../../utils/logging"

const NOMIC_CODE_QUERY_PREFIX = "Represent this query for searching relevant code: "

function factoryFor(config: Record<string, unknown>, secrets: Record<string, string> = {}) {
	const proxy = {
		getGlobalState: () => ({
			codebaseIndexEnabled: true,
			codebaseIndexQdrantUrl: "http://qdrant:6333",
			...config,
		}),
		getSecret: (key: string) => ({ codeIndexQdrantApiKey: "q-key", ...secrets })[key],
	}
	const cacheManager = {} as any
	return new CodeIndexServiceFactory(new CodeIndexConfigManager(proxy as any), "/ws", cacheManager)
}

const ollama = (model?: string, extra: Record<string, unknown> = {}) => ({
	codebaseIndexEmbedderProvider: "ollama",
	codebaseIndexEmbedderBaseUrl: "http://ollama:11434",
	codebaseIndexEmbedderModelId: model,
	...extra,
})
const compatible = (model: string, extra: Record<string, unknown> = {}) => ({
	codebaseIndexEmbedderProvider: "openai-compatible",
	codebaseIndexOpenAiCompatibleBaseUrl: "http://llama:11111/v1",
	codebaseIndexEmbedderModelId: model,
	...extra,
})

const embedderAnswering = (validateConfiguration: IEmbedder["validateConfiguration"]) =>
	({ validateConfiguration }) as IEmbedder

beforeEach(() => {
	vi.mocked(QdrantVectorStore).mockClear()
	vi.mocked(TelemetryService.instance.captureEvent).mockClear()
	vi.spyOn(logger, "warn").mockImplementation(() => {})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("CodeIndexServiceFactory.createVectorStore", () => {
	it.each([
		["the model's own dimension", ollama("mxbai-embed-large"), 1024, undefined],
		["the default model's dimension", ollama(undefined), 768, undefined],
		[
			"the built-in dimension over a manual one",
			compatible("text-embedding-3-small", { codebaseIndexEmbedderModelDimension: 999 }),
			1536,
			undefined,
		],
		[
			"the manual dimension of a model the table does not know",
			compatible("qwen3-embed", { codebaseIndexEmbedderModelDimension: 2560 }),
			2560,
			undefined,
		],
		[
			"the query prefix legacy vectors of this model were embedded with",
			ollama("nomic-embed-code"),
			3584,
			NOMIC_CODE_QUERY_PREFIX,
		],
	])("builds the store with %s", (_, config, vectorSize, legacyDocumentPrefix) => {
		factoryFor(config, { codebaseIndexOpenAiCompatibleApiKey: "k" }).createVectorStore()

		expect(QdrantVectorStore).toHaveBeenCalledWith("/ws", "http://qdrant:6333", vectorSize, "q-key", {
			legacyDocumentPrefix,
		})
	})

	it.each([
		[
			"an OpenAI-compatible model without a dimension",
			compatible("qwen3-embed"),
			"vectorDimensionNotDeterminedOpenAiCompatible",
		],
		["an unknown Ollama model", ollama("my-model"), "serviceFactory.vectorDimensionNotDetermined {"],
		["a missing Qdrant URL", ollama(undefined, { codebaseIndexQdrantUrl: "" }), "qdrantUrlMissing"],
	])("refuses %s", (_, config, message) => {
		expect(() => factoryFor(config).createVectorStore()).toThrow(message)
		expect(QdrantVectorStore).not.toHaveBeenCalled()
	})
})

describe("CodeIndexServiceFactory.validateEmbedder", () => {
	const factory = () => factoryFor(ollama("mxbai-embed-large"))

	it.each([
		["a failed validation as it is", { valid: false, error: "bad key" }, { valid: false, error: "bad key" }],
		["a matching probe dimension", { valid: true, dimension: 1024 }, { valid: true, dimension: 1024 }],
		["a validation without a dimension", { valid: true }, { valid: true }],
	])("passes %s", async (_, result, expected) => {
		await expect(factory().validateEmbedder(embedderAnswering(async () => result))).resolves.toEqual(expected)
	})

	it("rejects a probe dimension that differs from the configured one", async () => {
		const result = await factory().validateEmbedder(
			embedderAnswering(async () => ({ valid: true, dimension: 768 })),
		)

		expect(result).toEqual({
			valid: false,
			error: 'embeddings:validation.dimensionMismatch {"modelId":"mxbai-embed-large","actualDimension":768,"configuredDimension":1024}',
		})
	})

	it("does not second-guess a probe dimension when no dimension can be resolved", async () => {
		const result = await factoryFor(ollama("my-model")).validateEmbedder(
			embedderAnswering(async () => ({ valid: true, dimension: 768 })),
		)

		expect(result).toEqual({ valid: true, dimension: 768 })
	})

	it.each([
		["an Error, with its message", new Error("socket hang up"), "socket hang up"],
		["anything else, as the configuration error", "boom", "embeddings:validation.configurationError"],
	])("reports a validation that throws %s, once to telemetry", async (_, thrown, error) => {
		const result = await factory().validateEmbedder(
			embedderAnswering(async () => {
				throw thrown
			}),
		)

		expect(result).toEqual({ valid: false, error })
		expect(TelemetryService.instance.captureEvent).toHaveBeenCalledTimes(1)
		expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(expect.anything(), {
			error: thrown instanceof Error ? thrown.message : thrown,
			stack: thrown instanceof Error ? thrown.stack : undefined,
			location: "validateEmbedder",
		})
	})
})

describe("CodeIndexServiceFactory.createServices", () => {
	it("refuses while code indexing is not configured", () => {
		expect(() =>
			factoryFor(ollama(undefined, { codebaseIndexEmbedderBaseUrl: "" })).createServices(
				{} as any,
				{} as any,
				{} as any,
			),
		).toThrow("embeddings:serviceFactory.codeIndexingNotConfigured")
	})

	it("builds the scanner and the file watcher with the configured batch size", () => {
		const get = vi.fn(() => 7)
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({ get } as any)

		const services = factoryFor(ollama("mxbai-embed-large")).createServices(
			{} as any,
			{} as any,
			{} as any,
			{} as any,
		)

		expect(services.scanner).toBeInstanceOf(DirectoryScanner)
		expect(services.fileWatcher).toBeInstanceOf(FileWatcher)
		expect(get).toHaveBeenCalledTimes(2)
		expect(get).toHaveBeenCalledWith("codeIndex.embeddingBatchSize", expect.any(Number))
		expect((services.scanner as any).batchSegmentThreshold).toBe(7)
		expect((services.fileWatcher as any).batchSegmentThreshold).toBe(7)
	})
})
