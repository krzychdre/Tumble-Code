// The index remembers which prefix its code chunks were embedded with, and a collection whose
// stored vectors were embedded differently from what indexing sends now is rebuilt.
//
// Until 2026-09-25 the model's QUERY prefix (nomic-embed-code: "Represent this query for
// searching relevant code: ") was also put in front of every indexed code chunk. Indexing now
// embeds code without it, so an existing nomic-embed-code collection holds vectors of different
// input than new ones; mixing them would silently degrade search. Such a collection has no
// `document_prefix` on its metadata point, and the factory tells the store which prefix those
// legacy vectors were built with.

const client = vitest.hoisted(() => ({
	getCollection: vitest.fn(),
	createCollection: vitest.fn(),
	deleteCollection: vitest.fn(),
	createPayloadIndex: vitest.fn(),
	retrieve: vitest.fn(),
	upsert: vitest.fn(),
}))

vitest.mock("@qdrant/js-client-rest", () => ({
	QdrantClient: vitest.fn(() => client),
}))

vitest.mock("../../../../i18n", () => ({
	t: (key: string) => key,
}))

import * as path from "path"
import { v5 as uuidv5 } from "uuid"

import { QdrantVectorStore } from "../qdrant-client"
import { QDRANT_CODE_BLOCK_NAMESPACE } from "../../constants"

const NOMIC_CODE_QUERY_PREFIX = "Represent this query for searching relevant code: "
const workspace = path.resolve(path.sep, "work", "repo")
const metadataId = uuidv5("__indexing_metadata__", QDRANT_CODE_BLOCK_NAMESPACE)
const SIZE = 4

const collectionInfo = (pointsCount: number, size = SIZE) => ({
	points_count: pointsCount,
	config: { params: { vectors: { size, distance: "Cosine" } } },
})

const notFound = () => Object.assign(new Error("Not Found"), { status: 404 })

function store(legacyDocumentPrefix?: string) {
	return new QdrantVectorStore(workspace, "http://localhost:6333", SIZE, undefined, { legacyDocumentPrefix })
}

/** getCollection answers `info` until the collection is deleted, then "not found". */
function existingCollection(info: ReturnType<typeof collectionInfo>) {
	let deleted = false
	client.getCollection.mockImplementation(async () => {
		if (deleted) throw notFound()
		return info
	})
	client.deleteCollection.mockImplementation(async () => {
		deleted = true
		return true
	})
}

const metadataPoint = (payload: Record<string, unknown>) => [{ id: metadataId, payload: { type: "metadata", ...payload } }]

describe("QdrantVectorStore document prefix marker", () => {
	beforeEach(() => {
		vitest.clearAllMocks()
		vitest.spyOn(console, "log").mockImplementation(() => {})
		vitest.spyOn(console, "warn").mockImplementation(() => {})
		vitest.spyOn(console, "error").mockImplementation(() => {})
		client.createCollection.mockResolvedValue(true)
		client.createPayloadIndex.mockResolvedValue({})
		client.upsert.mockResolvedValue({ status: "completed" })
		client.retrieve.mockResolvedValue([])
	})

	afterEach(() => {
		vitest.restoreAllMocks()
	})

	describe("markers record the document prefix of the vectors being written", () => {
		it.each([
			["markIndexingIncomplete", false],
			["markIndexingComplete", true],
		] as const)("%s stores document_prefix: '' (code is embedded without a prefix)", async (method, complete) => {
			await store(NOMIC_CODE_QUERY_PREFIX)[method]()

			const point = client.upsert.mock.calls[0][1].points[0]
			expect(point.id).toBe(metadataId)
			expect(point.payload).toMatchObject({ type: "metadata", indexing_complete: complete, document_prefix: "" })
		})
	})

	describe("initialize()", () => {
		it("rebuilds a legacy collection (no document_prefix) whose vectors were built with a prefix", async () => {
			existingCollection(collectionInfo(120))
			client.retrieve.mockResolvedValue(metadataPoint({ indexing_complete: true }))

			const created = await store(NOMIC_CODE_QUERY_PREFIX).initialize()

			expect(created).toBe(true)
			expect(client.retrieve).toHaveBeenCalledWith(expect.any(String), { ids: [metadataId] })
			expect(client.deleteCollection).toHaveBeenCalledTimes(1)
			expect(client.createCollection).toHaveBeenCalledTimes(1)
			expect(client.createCollection.mock.calls[0][1].vectors.size).toBe(SIZE)
		})

		it("rebuilds a legacy collection without any metadata point too (pre-marker index)", async () => {
			existingCollection(collectionInfo(120))
			client.retrieve.mockResolvedValue([])

			expect(await store(NOMIC_CODE_QUERY_PREFIX).initialize()).toBe(true)
			expect(client.deleteCollection).toHaveBeenCalledTimes(1)
		})

		it("keeps a collection already marked with the current document prefix", async () => {
			existingCollection(collectionInfo(120))
			client.retrieve.mockResolvedValue(metadataPoint({ indexing_complete: true, document_prefix: "" }))

			expect(await store(NOMIC_CODE_QUERY_PREFIX).initialize()).toBe(false)
			expect(client.deleteCollection).not.toHaveBeenCalled()
			expect(client.createCollection).not.toHaveBeenCalled()
		})

		it("keeps a legacy collection of a model that never had a prefix (no needless reindex)", async () => {
			existingCollection(collectionInfo(120))
			client.retrieve.mockResolvedValue(metadataPoint({ indexing_complete: true }))

			expect(await store(undefined).initialize()).toBe(false)
			expect(await store("").initialize()).toBe(false)
			expect(client.deleteCollection).not.toHaveBeenCalled()
		})

		it("rebuilds a collection marked with a different document prefix", async () => {
			existingCollection(collectionInfo(120))
			client.retrieve.mockResolvedValue(metadataPoint({ document_prefix: "search_document: " }))

			expect(await store(undefined).initialize()).toBe(true)
			expect(client.deleteCollection).toHaveBeenCalledTimes(1)
		})

		it("does not look at an empty collection", async () => {
			existingCollection(collectionInfo(0))

			expect(await store(NOMIC_CODE_QUERY_PREFIX).initialize()).toBe(false)
			expect(client.retrieve).not.toHaveBeenCalled()
			expect(client.deleteCollection).not.toHaveBeenCalled()
		})

		it("keeps the collection when the marker cannot be read", async () => {
			existingCollection(collectionInfo(120))
			client.retrieve.mockRejectedValue(new Error("Service Unavailable"))

			expect(await store(NOMIC_CODE_QUERY_PREFIX).initialize()).toBe(false)
			expect(client.deleteCollection).not.toHaveBeenCalled()
		})

		it("still recreates on a dimension change without reading the marker", async () => {
			existingCollection(collectionInfo(120, SIZE + 1))

			expect(await store(NOMIC_CODE_QUERY_PREFIX).initialize()).toBe(true)
			expect(client.deleteCollection).toHaveBeenCalledTimes(1)
			expect(client.createCollection).toHaveBeenCalledTimes(1)
		})
	})
})
