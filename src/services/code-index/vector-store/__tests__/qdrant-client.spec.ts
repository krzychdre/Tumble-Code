// QdrantVectorStore runs the REAL `@qdrant/js-client-rest` client (no module mock) against a fake
// Qdrant HTTP server on 127.0.0.1 and pins the exact requests we send and how we read the answers.
//
// The real client matters: it passes its own undici `Agent` as `dispatcher` to Node's built-in fetch,
// and an undici major that the built-in fetch cannot drive (undici 8 on Node 22/24) breaks every
// request. Its errors are real `ApiError`s whose message is only the status text, with Qdrant's
// reason on `error.data`.

import * as http from "node:http"
import type { AddressInfo } from "node:net"
import { createHash } from "crypto"
import * as path from "path"
import nock from "nock"
import { v5 as uuidv5 } from "uuid"

import { QdrantVectorStore, describeQdrantError } from "../qdrant-client"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE, QDRANT_CODE_BLOCK_NAMESPACE } from "../../constants"
import { logger } from "../../../../utils/logging"

vitest.mock("../../../../i18n", () => ({
	t: (key: string, params?: Record<string, unknown>) =>
		params?.errorMessage !== undefined ? `${key} | ${String(params.errorMessage)}` : key,
}))

interface RecordedRequest {
	method: string
	path: string
	headers: http.IncomingHttpHeaders
	body: unknown
}

interface FakeResponse {
	status: number
	body: unknown
}

type Handler = (req: RecordedRequest) => FakeResponse | undefined

const ok = (result: unknown): FakeResponse => ({ status: 200, body: { result, status: "ok", time: 0.001 } })
const qdrantError = (status: number, reason: string): FakeResponse => ({
	status,
	body: { status: { error: reason }, time: 0.001 },
})

const NOMIC_CODE_QUERY_PREFIX = "Represent this query for searching relevant code: "
const workspacePath = path.resolve(path.sep, "work", "repo")
const collectionName = `ws-${createHash("sha256").update(workspacePath).digest("hex").substring(0, 16)}`
const collectionPath = `/collections/${collectionName}`
const pointsPath = `${collectionPath}/points`
const metadataId = uuidv5("__indexing_metadata__", QDRANT_CODE_BLOCK_NAMESPACE)

const collectionInfo = (size: unknown, pointsCount = 0) => ({
	status: "green",
	optimizer_status: "ok",
	points_count: pointsCount,
	indexed_vectors_count: 0,
	segments_count: 1,
	config: { params: { vectors: typeof size === "number" ? { size, distance: "Cosine" } : size } },
	payload_schema: {},
})

const metadataPoint = (payload: Record<string, unknown>) =>
	ok([{ id: metadataId, payload: { type: "metadata", ...payload } }])

let server: http.Server
let baseUrl: string
let recorded: RecordedRequest[] = []
let handler: Handler = () => undefined

/** Requests our code made, without the client's own background version probe (`GET /`). */
function apiRequests() {
	return recorded.filter((r) => !(r.method === "GET" && r.path === "/"))
}

function calls() {
	return apiRequests().map((r) => ({ method: r.method, path: r.path, body: r.body }))
}

function createStore(vectorSize = 768, legacyDocumentPrefix?: string) {
	return new QdrantVectorStore(workspacePath, baseUrl, vectorSize, "secret-key", { legacyDocumentPrefix })
}

/**
 * An existing collection: GET answers `info` until a DELETE succeeds, then 404; index and create
 * PUTs succeed; `routes` answers everything else (and may override the defaults).
 */
function existingCollection(info: object, routes: Handler = () => undefined): Handler {
	let deleted = false
	return (req) => {
		const routed = routes(req)
		if (routed) {
			if (req.method === "DELETE" && routed.status === 200) deleted = true
			return routed
		}
		if (req.method === "GET" && req.path === collectionPath) {
			return deleted ? qdrantError(404, "Not found") : ok(info)
		}
		if (req.method === "DELETE" && req.path === collectionPath) {
			deleted = true
			return ok(true)
		}
		if (req.method === "PUT") return ok(true)
		return undefined
	}
}

const failure = (promise: Promise<unknown>) =>
	promise.then(
		() => undefined,
		(e: unknown) => e as Error & { status?: number; cause?: unknown },
	)

beforeAll(async () => {
	// vitest.setup.ts activates nock, which replaces globalThis.fetch with an interceptor that rebuilds
	// the request and drops the `dispatcher` option. Restore the real fetch so the client drives its
	// own undici Agent exactly as it does inside VS Code.
	nock.restore()

	server = http.createServer((req, res) => {
		const chunks: Buffer[] = []
		req.on("data", (chunk: Buffer) => chunks.push(chunk))
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8")
			const entry: RecordedRequest = {
				method: req.method ?? "",
				path: req.url ?? "",
				headers: req.headers,
				body: raw ? JSON.parse(raw) : undefined,
			}
			recorded.push(entry)

			const response =
				entry.method === "GET" && entry.path === "/"
					? { status: 200, body: { title: "qdrant - vector search engine", version: "1.15.0" } }
					: (handler(entry) ?? qdrantError(404, `fake server: no route for ${entry.method} ${entry.path}`))

			res.writeHead(response.status, { "content-type": "application/json" })
			res.end(JSON.stringify(response.body))
		})
	})

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
	server.closeAllConnections()
	await new Promise<void>((resolve) => server.close(() => resolve()))
	nock.activate()
})

beforeEach(() => {
	recorded = []
	handler = () => undefined
	vitest.spyOn(logger, "info").mockImplementation(() => {})
	vitest.spyOn(logger, "warn").mockImplementation(() => {})
	vitest.spyOn(logger, "error").mockImplementation(() => {})
})

afterEach(() => {
	vitest.restoreAllMocks()
})

const expectedCreateBody = (size: number) => ({
	vectors: { size, distance: "Cosine", on_disk: true },
	hnsw_config: { m: 64, ef_construct: 512, on_disk: true },
})

const expectedIndexCalls = [
	"type",
	"pathSegments.0",
	"pathSegments.1",
	"pathSegments.2",
	"pathSegments.3",
	"pathSegments.4",
].map((field) => ({
	method: "PUT",
	path: `${collectionPath}/index`,
	body: { field_name: field, field_schema: "keyword" },
}))

const recreateCalls = (size: number) => [
	{ method: "DELETE", path: collectionPath, body: undefined },
	{ method: "GET", path: collectionPath, body: undefined },
	{ method: "PUT", path: collectionPath, body: expectedCreateBody(size) },
]

const deletedCollection = () => calls().some((c) => c.method === "DELETE")

describe("QdrantVectorStore.initialize", () => {
	it("creates a missing collection with the configured vector size and the payload indexes", async () => {
		handler = (req) => {
			if (req.method === "GET" && req.path === collectionPath) {
				return qdrantError(404, `Not found: Collection \`${collectionName}\` doesn't exist!`)
			}
			if (req.method === "PUT") return ok(true)
			return undefined
		}

		await expect(createStore(768).initialize()).resolves.toBe(true)

		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			{ method: "PUT", path: collectionPath, body: expectedCreateBody(768) },
			...expectedIndexCalls,
		])

		for (const req of apiRequests()) {
			expect(req.headers["user-agent"]).toBe("Tumble-Code")
			expect(req.headers["api-key"]).toBe("secret-key")
		}
		expect(apiRequests()[1].headers["content-type"]).toMatch(/^application\/json/)
	})

	it("keeps an existing collection whose vector size matches and treats 'already exists' index errors as success", async () => {
		handler = existingCollection(collectionInfo(768, 3), (req) => {
			if (req.method === "POST" && req.path === pointsPath) return metadataPoint({ document_prefix: "" })
			if (req.method === "PUT") return qdrantError(400, "Bad request: Index already exists")
			return undefined
		})

		await expect(createStore(768).initialize()).resolves.toBe(false)

		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			// A non-empty collection: which document prefix were its vectors embedded with?
			{ method: "POST", path: pointsPath, body: { ids: [metadataId], with_payload: true } },
			...expectedIndexCalls,
		])
		// The "already exists" reason lives only on error.data, so being silent proves we read it.
		expect(logger.warn).not.toHaveBeenCalledWith(
			expect.stringContaining("Could not create payload index"),
			expect.anything(),
		)
	})

	it("logs other payload index errors and still finishes", async () => {
		handler = existingCollection(collectionInfo(768), (req) =>
			req.path.endsWith("/index") ? qdrantError(500, "Service internal error: disk full") : undefined,
		)

		await expect(createStore(768).initialize()).resolves.toBe(false)

		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Could not create payload index for type"),
			"Internal Server Error: Service internal error: disk full",
		)
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Could not create payload index for pathSegments.4"),
			"Internal Server Error: Service internal error: disk full",
		)
	})

	it.each([
		["a different size", collectionInfo(1024, 10), true],
		["the same size given as a bare number", collectionInfo(768), false],
		["named vectors (size unknown, read as 0)", collectionInfo({ dense: { size: 768, distance: "Cosine" } }), true],
	])("an existing collection with %s is recreated: %s", async (_, info, recreated) => {
		handler = existingCollection(info)

		await expect(createStore(768).initialize()).resolves.toBe(recreated)

		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			...(recreated ? recreateCalls(768) : []),
			...expectedIndexCalls,
		])
	})

	it("recreates a same-size collection whose code chunks were embedded with the legacy query prefix", async () => {
		// Legacy marker: written before document_prefix existed
		handler = existingCollection(collectionInfo(768, 10), (req) =>
			req.method === "POST" && req.path === pointsPath ? metadataPoint({ indexing_complete: true }) : undefined,
		)

		await expect(createStore(768, NOMIC_CODE_QUERY_PREFIX).initialize()).resolves.toBe(true)

		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			{ method: "POST", path: pointsPath, body: { ids: [metadataId], with_payload: true } },
			...recreateCalls(768),
			...expectedIndexCalls,
		])
	})

	// The index remembers which prefix its code chunks were embedded with (`document_prefix` on the
	// metadata point; a legacy index has none and the factory says which prefix its vectors used).
	it.each([
		["no metadata point at all (pre-marker index)", 10, ok([]), NOMIC_CODE_QUERY_PREFIX, true],
		[
			"a marker with a different document prefix",
			10,
			metadataPoint({ document_prefix: "search_document: " }),
			undefined,
			true,
		],
		[
			"a marker with the current document prefix",
			10,
			metadataPoint({ document_prefix: "" }),
			NOMIC_CODE_QUERY_PREFIX,
			false,
		],
		[
			"a legacy marker of a model that never had a prefix",
			10,
			metadataPoint({ indexing_complete: true }),
			undefined,
			false,
		],
		["a marker that cannot be read", 10, qdrantError(503, "unavailable"), NOMIC_CODE_QUERY_PREFIX, false],
	])("a same-size collection with %s is recreated: %s", async (_, points, marker, legacyPrefix, recreated) => {
		handler = existingCollection(collectionInfo(768, points), (req) =>
			req.method === "POST" && req.path === pointsPath ? marker : undefined,
		)

		await expect(createStore(768, legacyPrefix).initialize()).resolves.toBe(recreated)
		expect(deletedCollection()).toBe(recreated)
	})

	it("does not read the marker of an empty collection", async () => {
		handler = existingCollection(collectionInfo(768, 0))

		await expect(createStore(768, NOMIC_CODE_QUERY_PREFIX).initialize()).resolves.toBe(false)
		expect(calls()).toEqual([{ method: "GET", path: collectionPath, body: undefined }, ...expectedIndexCalls])
	})

	it("surfaces Qdrant's reason when creating the collection fails", async () => {
		handler = (req) => {
			if (req.method === "GET" && req.path === collectionPath) return qdrantError(404, "Not found")
			if (req.method === "PUT" && req.path === collectionPath) {
				return qdrantError(400, "Wrong input: Vector size 0 is not allowed")
			}
			return undefined
		}

		await expect(createStore(768).initialize()).rejects.toThrow(
			"embeddings:vectorStore.qdrantConnectionFailed | Bad Request: Wrong input: Vector size 0 is not allowed",
		)
	})

	it.each([
		[
			"the delete fails",
			(req: RecordedRequest) => (req.method === "DELETE" ? qdrantError(500, "delete refused") : undefined),
			"Failed to delete existing collection with vector size 1024. Internal Server Error: delete refused",
		],
		[
			"the collection is still there after the delete",
			(req: RecordedRequest) => (req.method === "GET" ? ok(collectionInfo(1024)) : undefined),
			"Deleted existing collection but failed verification step. Collection still exists after deletion attempt",
		],
		[
			"creating the new collection fails",
			(req: RecordedRequest) =>
				req.method === "PUT" && req.path === collectionPath ? qdrantError(400, "bad size") : undefined,
			"Deleted existing collection but failed to create new collection with vector size 768. Bad Request: bad size",
		],
	])("a dimension change fails with the stage named when %s", async (_, routes, context) => {
		handler = existingCollection(collectionInfo(1024, 10), routes)

		const error = await failure(createStore(768).initialize())

		// Thrown as is, not wrapped into the connection error.
		expect(error?.message).toBe(`embeddings:vectorStore.vectorDimensionMismatch | ${context}`)
		expect(error?.cause).toBeInstanceOf(Error)
	})
})

describe("QdrantVectorStore points", () => {
	it("upserts points with path segments (when they have a file path) and waits for the write", async () => {
		handler = (req) => (req.method === "PUT" ? ok({ operation_id: 1, status: "completed" }) : undefined)

		const filePath = path.join("src", "services", "a.ts")
		await createStore().upsertPoints([
			{ id: "p1", vector: [0.1, 0.2], payload: { filePath, codeChunk: "x", startLine: 1, endLine: 2 } },
			{ id: "p2", vector: [0.3, 0.4], payload: { codeChunk: "y" } },
		])

		expect(calls()).toEqual([
			{
				method: "PUT",
				path: `${pointsPath}?wait=true`,
				body: {
					points: [
						{
							id: "p1",
							vector: [0.1, 0.2],
							payload: {
								filePath,
								codeChunk: "x",
								startLine: 1,
								endLine: 2,
								pathSegments: { "0": "src", "1": "services", "2": "a.ts" },
							},
						},
						{ id: "p2", vector: [0.3, 0.4], payload: { codeChunk: "y" } },
					],
				},
			},
		])
	})

	it("searches through the query endpoint with a directory filter and drops invalid payloads", async () => {
		const valid = { filePath: "src/a.ts", codeChunk: "x", startLine: 1, endLine: 2, pathSegments: { "0": "src" } }
		handler = (req) =>
			req.method === "POST" && req.path === `${pointsPath}/query`
				? ok({
						points: [
							{ id: "p1", version: 1, score: 0.9, payload: valid },
							{ id: "p2", version: 1, score: 0.8, payload: { filePath: "only" } },
							{ id: "p3", version: 1, score: 0.7, payload: null },
						],
					})
				: undefined

		const results = await createStore().search([0.5, 0.25], "src/services", 0.5, 7)

		expect(results).toEqual([{ id: "p1", version: 1, score: 0.9, payload: valid }])
		expect(calls()).toEqual([
			{
				method: "POST",
				path: `${pointsPath}/query`,
				body: {
					query: [0.5, 0.25],
					filter: {
						must: [
							{ key: "pathSegments.0", match: { value: "src" } },
							{ key: "pathSegments.1", match: { value: "services" } },
						],
						must_not: [{ key: "type", match: { value: "metadata" } }],
					},
					score_threshold: 0.5,
					limit: 7,
					params: { hnsw_ef: 128, exact: false },
					with_payload: { include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"] },
				},
			},
		])
	})

	it.each([
		[undefined, []],
		["", []],
		[".", []],
		["./", []],
		[".\\", []],
		["./src", ["src"]],
		["src//", ["src"]],
		["src\\utils", ["src", "utils"]],
	])("searching below %j filters on the path segments %j", async (directoryPrefix, segments) => {
		handler = () => ok({ points: [] })

		await expect(createStore().search([1], directoryPrefix)).resolves.toEqual([])

		const must = segments.map((value, index) => ({ key: `pathSegments.${index}`, match: { value } }))
		expect(calls()[0].body).toMatchObject({
			query: [1],
			filter: {
				...(must.length > 0 ? { must } : {}),
				must_not: [{ key: "type", match: { value: "metadata" } }],
			},
			score_threshold: DEFAULT_SEARCH_MIN_SCORE,
			limit: DEFAULT_MAX_SEARCH_RESULTS,
		})
		expect(Object.keys((calls()[0].body as { filter: object }).filter)).toEqual(
			must.length > 0 ? ["must", "must_not"] : ["must_not"],
		)
	})

	it("deletes points of several files with one should-filter after checking the collection", async () => {
		handler = existingCollection(collectionInfo(768, 3), (req) =>
			req.method === "POST" ? ok({ operation_id: 2, status: "completed" }) : undefined,
		)

		await createStore().deletePointsByMultipleFilePaths([
			path.join(workspacePath, "src", "a.ts"),
			path.join("lib", "b.ts"),
		])

		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			{
				method: "POST",
				path: `${pointsPath}/delete?wait=true`,
				body: {
					filter: {
						should: [
							{
								must: [
									{ key: "pathSegments.0", match: { value: "src" } },
									{ key: "pathSegments.1", match: { value: "a.ts" } },
								],
							},
							{
								must: [
									{ key: "pathSegments.0", match: { value: "lib" } },
									{ key: "pathSegments.1", match: { value: "b.ts" } },
								],
							},
						],
					},
				},
			},
		])
	})

	it("clears the collection with an empty must-filter", async () => {
		handler = () => ok({ operation_id: 3, status: "completed" })

		await createStore().clearCollection()

		expect(calls()).toEqual([
			{ method: "POST", path: `${pointsPath}/delete?wait=true`, body: { filter: { must: [] } } },
		])
	})

	it.each([
		["an existing", ok(collectionInfo(768)), true],
		["a missing", qdrantError(404, "Not found"), false],
	])("deleteCollection on %s collection sends DELETE: %s", async (_, info, deletes) => {
		handler = (req) => (req.method === "GET" ? info : ok(true))

		await createStore().deleteCollection()

		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			...(deletes ? [{ method: "DELETE", path: collectionPath, body: undefined }] : []),
		])
	})

	const reason = "Wrong input: Vector dimension error: expected dim: 1024, got 768"
	it.each([
		["upsertPoints", (s: QdrantVectorStore) => s.upsertPoints([{ id: "p1", vector: [0.1], payload: {} }])],
		["search", (s: QdrantVectorStore) => s.search([1])],
		["deletePointsByFilePath", (s: QdrantVectorStore) => s.deletePointsByFilePath("a.ts")],
		["clearCollection", (s: QdrantVectorStore) => s.clearCollection()],
		["deleteCollection", (s: QdrantVectorStore) => s.deleteCollection()],
		["markIndexingComplete", (s: QdrantVectorStore) => s.markIndexingComplete()],
	])("%s rethrows with Qdrant's reason (error.data) and keeps the status", async (_, operation) => {
		handler = (req) => (req.method === "GET" ? ok(collectionInfo(768, 1)) : qdrantError(400, reason))

		const error = await failure(operation(createStore()))

		expect(error).toBeInstanceOf(Error)
		expect(error?.message).toBe(`Bad Request: ${reason}`)
		expect(error?.status).toBe(400)
		expect(error?.cause).toBeInstanceOf(Error)
	})
})

describe("QdrantVectorStore indexing marker", () => {
	it("reads the indexing-complete marker through retrieve and writes it through upsert", async () => {
		handler = existingCollection(collectionInfo(768, 5), (req) => {
			if (req.method === "POST" && req.path === pointsPath) return metadataPoint({ indexing_complete: true })
			if (req.method === "PUT") return ok({ operation_id: 4, status: "completed" })
			return undefined
		})

		const store = createStore(3, NOMIC_CODE_QUERY_PREFIX)
		await expect(store.hasIndexedData()).resolves.toBe(true)
		await store.markIndexingComplete()
		await store.markIndexingIncomplete()

		const marker = (complete: boolean, timeKey: string) => ({
			method: "PUT",
			path: `${pointsPath}?wait=true`,
			body: {
				points: [
					{
						id: metadataId,
						vector: [0, 0, 0],
						// Code is embedded without a prefix now, whatever the legacy prefix was.
						payload: {
							type: "metadata",
							indexing_complete: complete,
							document_prefix: "",
							[timeKey]: expect.any(Number),
						},
					},
				],
			},
		})
		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			{ method: "POST", path: pointsPath, body: { ids: [metadataId], with_payload: true } },
			marker(true, "completed_at"),
			marker(false, "started_at"),
		])
	})

	it.each([
		["a missing collection", qdrantError(404, "Not found"), ok([]), false],
		["an empty collection", ok(collectionInfo(768, 0)), ok([]), false],
		["points but no marker (index from before the marker)", ok(collectionInfo(768, 5)), ok([]), true],
		["an unfinished marker", ok(collectionInfo(768, 5)), metadataPoint({ indexing_complete: false }), false],
		["a marker that cannot be read", ok(collectionInfo(768, 5)), qdrantError(500, "boom"), false],
	])("hasIndexedData with %s is %s", async (_, info, marker, expected) => {
		handler = (req) => (req.method === "GET" ? info : marker)

		await expect(createStore().hasIndexedData()).resolves.toBe(expected)
	})
})

describe("describeQdrantError", () => {
	const apiError = (message: string, data: unknown) => Object.assign(new Error(message), { data })
	const circular: Record<string, unknown> = {}
	circular.self = circular

	it.each([
		["status.error on data", apiError("Bad Request", { status: { error: "bad dim" } }), "Bad Request: bad dim"],
		[
			"status string on response.data",
			Object.assign(new Error("Bad Request"), { response: { data: { status: "nope" } } }),
			"Bad Request: nope",
		],
		["a string body (trimmed)", apiError("Bad Gateway", "  upstream down \n"), "Bad Gateway: upstream down"],
		["a blank string body", apiError("Bad Gateway", "   "), "Bad Gateway"],
		["any other body, serialized", apiError("Bad Request", { result: null }), 'Bad Request: {"result":null}'],
		["an empty body", apiError("Bad Request", {}), "Bad Request"],
		["a body that cannot be serialized", apiError("Bad Request", circular), "Bad Request"],
		[
			"a reason the message already holds",
			apiError("Bad Request: bad dim", { status: { error: "bad dim" } }),
			"Bad Request: bad dim",
		],
		["an empty message", apiError("", { status: { error: "bad dim" } }), "bad dim"],
		["no body", new Error("fetch failed"), "fetch failed"],
		["a non-Error", "plain text", "plain text"],
	])("%s", (_, error, expected) => {
		expect(describeQdrantError(error)).toBe(expected)
	})
})
