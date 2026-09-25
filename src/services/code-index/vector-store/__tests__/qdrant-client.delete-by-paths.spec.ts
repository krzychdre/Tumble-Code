// Characterization spec for QdrantVectorStore.deletePointsByMultipleFilePaths (and the single-path
// wrapper deletePointsByFilePath). The Qdrant client is mocked; `path` is the REAL module, loaded
// once as POSIX and once as win32, so the Windows separator handling is exercised on every OS.
// Every path is built with the path implementation under test (join/resolve), never hard-coded.

import * as nodePath from "path"

const client = vitest.hoisted(() => ({
	getCollection: vitest.fn(),
	delete: vitest.fn(),
	upsert: vitest.fn(),
}))

vitest.mock("@qdrant/js-client-rest", () => ({
	QdrantClient: vitest.fn(() => client),
}))

vitest.mock("../../../../i18n", () => ({
	t: (key: string) => key,
}))

type PathImpl = typeof nodePath.posix

/** Loads a fresh qdrant-client module whose `path` import is the given implementation. */
async function loadStoreClass(pathImpl: PathImpl) {
	vitest.resetModules()
	vitest.doMock("path", () => ({ ...pathImpl, default: pathImpl }))
	const mod = await import("../qdrant-client")
	vitest.doUnmock("path")
	return mod.QdrantVectorStore
}

const flavours: Array<{ name: string; impl: PathImpl; workspace: string }> = [
	{ name: "posix", impl: nodePath.posix, workspace: nodePath.posix.resolve("/", "work", "repo") },
	{ name: "win32", impl: nodePath.win32, workspace: nodePath.win32.resolve("C:\\", "work", "repo") },
]

const seg = (index: number, value: string) => ({ key: `pathSegments.${index}`, match: { value } })

describe.each(flavours)("QdrantVectorStore.deletePointsByMultipleFilePaths ($name paths)", ({ impl, workspace }) => {
	let store: InstanceType<Awaited<ReturnType<typeof loadStoreClass>>>

	beforeEach(async () => {
		vitest.clearAllMocks()
		vitest.spyOn(console, "warn").mockImplementation(() => {})
		vitest.spyOn(console, "error").mockImplementation(() => {})
		client.getCollection.mockResolvedValue({ points_count: 3, config: { params: { vectors: { size: 4 } } } })
		client.delete.mockResolvedValue({ status: "completed" })
		client.upsert.mockResolvedValue({ status: "completed" })

		const QdrantVectorStore = await loadStoreClass(impl)
		store = new QdrantVectorStore(workspace, "http://localhost:6333", 4)
	})

	afterEach(() => {
		vitest.restoreAllMocks()
	})

	const collectionName = () => (store as any).collectionName as string

	it("does nothing for an empty list (no collection probe, no delete)", async () => {
		await store.deletePointsByMultipleFilePaths([])

		expect(client.getCollection).not.toHaveBeenCalled()
		expect(client.delete).not.toHaveBeenCalled()
	})

	it("skips the delete when the collection does not exist", async () => {
		client.getCollection.mockRejectedValue(new Error("Not Found"))

		await expect(store.deletePointsByMultipleFilePaths([impl.join("src", "a.ts")])).resolves.toBeUndefined()

		expect(client.getCollection).toHaveBeenCalledWith(collectionName())
		expect(client.delete).not.toHaveBeenCalled()
	})

	it("matches one relative path segment by segment, without a should wrapper", async () => {
		await store.deletePointsByMultipleFilePaths([impl.join("src", "utils", "a.ts")])

		expect(client.delete).toHaveBeenCalledTimes(1)
		expect(client.delete).toHaveBeenCalledWith(collectionName(), {
			filter: { must: [seg(0, "src"), seg(1, "utils"), seg(2, "a.ts")] },
			wait: true,
		})
	})

	it("turns an absolute path inside the workspace into workspace-relative segments", async () => {
		await store.deletePointsByMultipleFilePaths([impl.join(workspace, "src", "a.ts")])

		expect(client.delete).toHaveBeenCalledWith(collectionName(), {
			filter: { must: [seg(0, "src"), seg(1, "a.ts")] },
			wait: true,
		})
	})

	it("normalizes '.' and '..' parts of a relative path", async () => {
		await store.deletePointsByMultipleFilePaths([impl.join(".", "src", "..", "lib", ".", "b.ts")])

		expect(client.delete).toHaveBeenCalledWith(collectionName(), {
			filter: { must: [seg(0, "lib"), seg(1, "b.ts")] },
			wait: true,
		})
	})

	it("an absolute path outside the workspace yields '..' segments that match no indexed point", async () => {
		const outside = impl.join(impl.dirname(workspace), "other", "c.ts")

		await store.deletePointsByMultipleFilePaths([outside])

		expect(client.delete).toHaveBeenCalledWith(collectionName(), {
			filter: { must: [seg(0, ".."), seg(1, "other"), seg(2, "c.ts")] },
			wait: true,
		})
	})

	it("a directory path is a prefix match (deletes every point below it)", async () => {
		await store.deletePointsByMultipleFilePaths([impl.join(workspace, "src")])

		expect(client.delete).toHaveBeenCalledWith(collectionName(), {
			filter: { must: [seg(0, "src")] },
			wait: true,
		})
	})

	it("sends several paths in ONE delete call as a should (OR) of per-file must filters, no batching", async () => {
		const many = Array.from({ length: 250 }, (_, i) => impl.join("pkg", `f${i}.ts`))

		await store.deletePointsByMultipleFilePaths([impl.join(workspace, "src", "a.ts"), ...many])

		expect(client.getCollection).toHaveBeenCalledTimes(1)
		expect(client.delete).toHaveBeenCalledTimes(1)
		const { filter, wait } = client.delete.mock.calls[0][1]
		expect(wait).toBe(true)
		expect(filter.should).toHaveLength(251)
		expect(filter.should[0]).toEqual({ must: [seg(0, "src"), seg(1, "a.ts")] })
		expect(filter.should[250]).toEqual({ must: [seg(0, "pkg"), seg(1, "f249.ts")] })
	})

	it("deletePointsByFilePath delegates to the multi-path form", async () => {
		await store.deletePointsByFilePath(impl.join("src", "a.ts"))

		expect(client.delete).toHaveBeenCalledWith(collectionName(), {
			filter: { must: [seg(0, "src"), seg(1, "a.ts")] },
			wait: true,
		})
	})

	it("builds exactly the pathSegments that upsertPoints stores for the same file", async () => {
		const relativeFile = impl.join("src", "deep", "nested", "file.ts")

		await store.upsertPoints([{ id: "1", vector: [0, 0, 0, 1], payload: { filePath: relativeFile } }])
		await store.deletePointsByMultipleFilePaths([impl.join(workspace, relativeFile)])

		const stored = client.upsert.mock.calls[0][1].points[0].payload.pathSegments as Record<string, string>
		const { filter } = client.delete.mock.calls[0][1]
		expect(filter.must).toEqual(Object.entries(stored).map(([index, value]) => seg(Number(index), value)))
	})

	it("propagates a failed delete to the caller, carrying Qdrant's reason", async () => {
		const apiError = Object.assign(new Error("Bad Request"), {
			status: 400,
			data: { status: { error: "Wrong input: payload index missing" } },
		})
		client.delete.mockRejectedValue(apiError)

		const result = store.deletePointsByMultipleFilePaths([impl.join("src", "a.ts")])

		await expect(result).rejects.toThrow("Bad Request: Wrong input: payload index missing")
		await expect(result).rejects.toMatchObject({ status: 400, cause: apiError })
	})
})
