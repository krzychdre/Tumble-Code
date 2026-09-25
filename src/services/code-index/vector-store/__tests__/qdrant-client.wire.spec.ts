// Wire-level spec for QdrantVectorStore: runs the REAL `@qdrant/js-client-rest` client (no module
// mock) against a fake Qdrant HTTP server on 127.0.0.1 and pins the exact requests we send.
//
// Why this exists: the Qdrant client passes its own undici `Agent` as `dispatcher` to Node's built-in
// fetch. An undici major that the built-in fetch cannot drive (undici 8 on Node 22/24) breaks every
// request, while `qdrant-client.spec.ts` mocks the whole module and stays green. This spec goes over
// real sockets, so a broken client/undici pairing or a changed wire format turns it red.

import * as http from "node:http"
import type { AddressInfo } from "node:net"
import { createHash } from "crypto"
import * as path from "path"
import nock from "nock"
import { v5 as uuidv5 } from "uuid"

import { QdrantVectorStore } from "../qdrant-client"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE, QDRANT_CODE_BLOCK_NAMESPACE } from "../../constants"

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

const workspacePath = path.resolve(path.sep, "work", "repo")
const collectionName = `ws-${createHash("sha256").update(workspacePath).digest("hex").substring(0, 16)}`
const collectionPath = `/collections/${collectionName}`
const metadataId = uuidv5("__indexing_metadata__", QDRANT_CODE_BLOCK_NAMESPACE)

const collectionInfo = (size: number, pointsCount = 0) => ({
	status: "green",
	optimizer_status: "ok",
	points_count: pointsCount,
	indexed_vectors_count: 0,
	segments_count: 1,
	config: { params: { vectors: { size, distance: "Cosine" } } },
	payload_schema: {},
})

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

function createStore(vectorSize = 768) {
	return new QdrantVectorStore(workspacePath, baseUrl, vectorSize, "secret-key")
}

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
	vitest.spyOn(console, "log").mockImplementation(() => {})
	vitest.spyOn(console, "warn").mockImplementation(() => {})
	vitest.spyOn(console, "error").mockImplementation(() => {})
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

describe("QdrantVectorStore against a fake Qdrant server (real client)", () => {
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
			expect(req.headers["user-agent"]).toBe("Roo-Code")
			expect(req.headers["api-key"]).toBe("secret-key")
		}
		expect(apiRequests()[1].headers["content-type"]).toMatch(/^application\/json/)
	})

	it("keeps an existing collection whose vector size matches and treats 'already exists' index errors as success", async () => {
		handler = (req) => {
			if (req.method === "GET" && req.path === collectionPath) return ok(collectionInfo(768, 3))
			if (req.method === "PUT" && req.path === `${collectionPath}/index`) {
				return qdrantError(400, "Bad request: Index already exists")
			}
			return undefined
		}

		await expect(createStore(768).initialize()).resolves.toBe(false)

		expect(calls()).toEqual([{ method: "GET", path: collectionPath, body: undefined }, ...expectedIndexCalls])
		// The "already exists" reason lives only on error.data, so being silent proves we read it.
		expect(console.warn).not.toHaveBeenCalledWith(
			expect.stringContaining("Could not create payload index"),
			expect.anything(),
		)
	})

	it("recreates a collection whose vector size differs from the configured one", async () => {
		let deleted = false
		handler = (req) => {
			if (req.method === "GET" && req.path === collectionPath) {
				return deleted ? qdrantError(404, "Not found") : ok(collectionInfo(1024, 10))
			}
			if (req.method === "DELETE" && req.path === collectionPath) {
				deleted = true
				return ok(true)
			}
			if (req.method === "PUT") return ok(true)
			return undefined
		}

		await expect(createStore(768).initialize()).resolves.toBe(true)

		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			{ method: "DELETE", path: collectionPath, body: undefined },
			{ method: "GET", path: collectionPath, body: undefined },
			{ method: "PUT", path: collectionPath, body: expectedCreateBody(768) },
			...expectedIndexCalls,
		])
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

	it("upserts points with path segments and waits for the write", async () => {
		handler = (req) => (req.method === "PUT" ? ok({ operation_id: 1, status: "completed" }) : undefined)

		const filePath = path.join("src", "services", "a.ts")
		await createStore().upsertPoints([
			{ id: "p1", vector: [0.1, 0.2], payload: { filePath, codeChunk: "x", startLine: 1, endLine: 2 } },
		])

		expect(calls()).toEqual([
			{
				method: "PUT",
				path: `${collectionPath}/points?wait=true`,
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
					],
				},
			},
		])
	})

	it("carries Qdrant's reason (error.data) into the upsert error and keeps the status", async () => {
		handler = () => qdrantError(400, "Wrong input: Vector dimension error: expected dim: 1024, got 768")

		const error = await createStore()
			.upsertPoints([{ id: "p1", vector: [0.1], payload: {} }])
			.then(
				() => undefined,
				(e: unknown) => e,
			)

		expect(error).toBeInstanceOf(Error)
		expect((error as Error).message).toBe(
			"Bad Request: Wrong input: Vector dimension error: expected dim: 1024, got 768",
		)
		expect((error as { status?: unknown }).status).toBe(400)
	})

	it("searches through the query endpoint with a directory filter and drops invalid payloads", async () => {
		const valid = { filePath: "src/a.ts", codeChunk: "x", startLine: 1, endLine: 2, pathSegments: { "0": "src" } }
		handler = (req) =>
			req.method === "POST" && req.path === `${collectionPath}/points/query`
				? ok({
						points: [
							{ id: "p1", version: 1, score: 0.9, payload: valid },
							{ id: "p2", version: 1, score: 0.8, payload: { filePath: "only" } },
						],
					})
				: undefined

		const results = await createStore().search([0.5, 0.25], "src/services", 0.5, 7)

		expect(results).toEqual([{ id: "p1", version: 1, score: 0.9, payload: valid }])
		expect(calls()).toEqual([
			{
				method: "POST",
				path: `${collectionPath}/points/query`,
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

	it("searches the whole workspace with the default threshold and limit", async () => {
		handler = () => ok({ points: [] })

		await expect(createStore().search([1])).resolves.toEqual([])

		expect(calls()[0].body).toMatchObject({
			query: [1],
			filter: { must_not: [{ key: "type", match: { value: "metadata" } }] },
			score_threshold: DEFAULT_SEARCH_MIN_SCORE,
			limit: DEFAULT_MAX_SEARCH_RESULTS,
		})
	})

	it("carries Qdrant's reason into a failed search", async () => {
		handler = () => qdrantError(500, "Service internal error: search failed")

		await expect(createStore().search([1])).rejects.toThrow(
			"Internal Server Error: Service internal error: search failed",
		)
	})

	it("deletes points of several files with one should-filter after checking the collection", async () => {
		handler = (req) => {
			if (req.method === "GET" && req.path === collectionPath) return ok(collectionInfo(768, 3))
			if (req.method === "POST") return ok({ operation_id: 2, status: "completed" })
			return undefined
		}

		await createStore().deletePointsByMultipleFilePaths([
			path.join(workspacePath, "src", "a.ts"),
			path.join("lib", "b.ts"),
		])

		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			{
				method: "POST",
				path: `${collectionPath}/points/delete?wait=true`,
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
			{ method: "POST", path: `${collectionPath}/points/delete?wait=true`, body: { filter: { must: [] } } },
		])
	})

	it("deletes the collection only when it exists", async () => {
		handler = (req) => {
			if (req.method === "GET" && req.path === collectionPath) return ok(collectionInfo(768))
			if (req.method === "DELETE") return ok(true)
			return undefined
		}

		await createStore().deleteCollection()

		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			{ method: "DELETE", path: collectionPath, body: undefined },
		])
	})

	it("reads the indexing-complete marker through retrieve and writes it through upsert", async () => {
		handler = (req) => {
			if (req.method === "GET" && req.path === collectionPath) return ok(collectionInfo(768, 5))
			if (req.method === "POST" && req.path === `${collectionPath}/points`) {
				return ok([{ id: metadataId, payload: { type: "metadata", indexing_complete: true } }])
			}
			if (req.method === "PUT") return ok({ operation_id: 4, status: "completed" })
			return undefined
		}

		const store = createStore(3)
		await expect(store.hasIndexedData()).resolves.toBe(true)
		await store.markIndexingComplete()

		expect(calls()).toEqual([
			{ method: "GET", path: collectionPath, body: undefined },
			{ method: "POST", path: `${collectionPath}/points`, body: { ids: [metadataId], with_payload: true } },
			{
				method: "PUT",
				path: `${collectionPath}/points?wait=true`,
				body: {
					points: [
						{
							id: metadataId,
							vector: [0, 0, 0],
							payload: { type: "metadata", indexing_complete: true, completed_at: expect.any(Number) },
						},
					],
				},
			},
		])
	})
})
