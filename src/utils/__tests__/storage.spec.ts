// `getStorageBasePath` memoizes successful storage-root resolutions in module
// state. To keep every test hermetic, each describe calls `vi.resetModules()`
// in `beforeEach` and re-imports both `vscode` and the module under test
// dynamically. `vi.resetModules()` re-instantiates the aliased vscode mock, so
// a top-level `import * as vscode` binding would be stale for the freshly
// imported `../storage` module — always use `freshVscode()` for spies.
const freshVscode = async () => (await import("vscode")) as typeof import("vscode")

vi.mock("fs/promises", async () => {
	const mod = await import("../../__mocks__/fs/promises")
	return (mod as any).default ?? mod
})

describe("getStorageBasePath - customStoragePath", () => {
	const defaultPath = "/test/global-storage"

	beforeEach(() => {
		vi.resetModules()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("returns the configured custom path when it is writable", async () => {
		const customPath = "/test/storage/path"
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const result = await getStorageBasePath(defaultPath)

		expect(result).toBe(customPath)
		expect((fsPromises as any).mkdir).toHaveBeenCalledWith(customPath, { recursive: true })
		expect((fsPromises as any).access).toHaveBeenCalledWith(customPath, 7) // 7 = R_OK(4) | W_OK(2) | X_OK(1)
	})

	it("falls back to default and shows an error when custom path is not writable", async () => {
		const customPath = "/test/storage/unwritable"
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		await (fsPromises as any).mkdir(customPath, { recursive: true })

		const accessMock = (fsPromises as any).access as ReturnType<typeof vi.fn>
		accessMock.mockImplementationOnce(async (p: string) => {
			if (p === customPath) {
				const err: any = new Error("EACCES: permission denied")
				err.code = "EACCES"
				throw err
			}
			return Promise.resolve()
		})

		const result = await getStorageBasePath(defaultPath)

		expect(result).toBe(defaultPath)
		expect(showErrorSpy).toHaveBeenCalledTimes(1)
		const firstArg = showErrorSpy.mock.calls[0][0]
		expect(typeof firstArg).toBe("string")
	})

	it("returns the default path when customStoragePath is an empty string and does not touch fs", async () => {
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(""),
		} as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const result = await getStorageBasePath(defaultPath)

		expect(result).toBe(defaultPath)
		expect((fsPromises as any).mkdir).not.toHaveBeenCalled()
		expect((fsPromises as any).access).not.toHaveBeenCalled()
	})

	it("falls back to default when mkdir fails and does not attempt access", async () => {
		const customPath = "/test/storage/failmkdir"
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const mkdirMock = (fsPromises as any).mkdir as ReturnType<typeof vi.fn>
		mkdirMock.mockImplementationOnce(async (p: string) => {
			if (p === customPath) {
				const err: any = new Error("EACCES: permission denied")
				err.code = "EACCES"
				throw err
			}
			return Promise.resolve()
		})

		const result = await getStorageBasePath(defaultPath)

		expect(result).toBe(defaultPath)
		expect((fsPromises as any).access).not.toHaveBeenCalled()
		expect(showErrorSpy).toHaveBeenCalledTimes(1)
	})

	it("passes the correct permission flags (R_OK | W_OK | X_OK) to fs.access", async () => {
		const customPath = "/test/storage/path"
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		await getStorageBasePath(defaultPath)

		const constants = (fsPromises as any).constants
		const expectedFlags = constants.R_OK | constants.W_OK | constants.X_OK

		expect((fsPromises as any).access).toHaveBeenCalledWith(customPath, expectedFlags)
	})

	it("falls back when directory is readable but not writable (partial permissions)", async () => {
		const customPath = "/test/storage/readonly"
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const accessMock = (fsPromises as any).access as ReturnType<typeof vi.fn>
		const constants = (fsPromises as any).constants
		accessMock.mockImplementationOnce(async (p: string, mode?: number) => {
			// Simulate readable (R_OK) but not writable/executable (W_OK | X_OK)
			if (p === customPath && mode && mode & (constants.W_OK | constants.X_OK)) {
				const err: any = new Error("EACCES: permission denied")
				err.code = "EACCES"
				throw err
			}
			return Promise.resolve()
		})

		const result = await getStorageBasePath(defaultPath)

		expect(result).toBe(defaultPath)
		expect(showErrorSpy).toHaveBeenCalledTimes(1)
	})
})

describe("getStorageBasePath - storage-root memoization", () => {
	const defaultPath = "/test/global-storage"

	beforeEach(() => {
		vi.resetModules()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("memoizes the storage root per (defaultPath, customStoragePath) pair", async () => {
		const customPath = "/test/storage/path"
		const configGet = vi.fn().mockReturnValue(customPath)
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({ get: configGet } as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const first = await getStorageBasePath(defaultPath)
		const second = await getStorageBasePath(defaultPath)

		expect(first).toBe(customPath)
		expect(second).toBe(customPath)
		// Config is still read on every call (self-invalidating key)...
		expect(configGet).toHaveBeenCalledTimes(2)
		// ...but the fs work (mkdir + access on the custom path) runs once.
		const mkdirCalls = (fsPromises as any).mkdir.mock.calls.filter((c: unknown[]) => c[0] === customPath)
		const accessCalls = (fsPromises as any).access.mock.calls.filter((c: unknown[]) => c[0] === customPath)
		expect(mkdirCalls).toHaveLength(1)
		expect(accessCalls).toHaveLength(1)
	})

	it("resolves fresh when the configured custom path changes", async () => {
		const firstPath = "/test/storage/first"
		const secondPath = "/test/storage/second"
		let configured = firstPath
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockImplementation(() => configured),
		} as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		expect(await getStorageBasePath(defaultPath)).toBe(firstPath)

		configured = secondPath
		expect(await getStorageBasePath(defaultPath)).toBe(secondPath)

		// New key → fs runs again for the second path.
		const mkdirCalls = (fsPromises as any).mkdir.mock.calls.filter(
			(c: unknown[]) => c[0] === firstPath || c[0] === secondPath,
		)
		expect(mkdirCalls.filter((c: unknown[]) => c[0] === firstPath)).toHaveLength(1)
		expect(mkdirCalls.filter((c: unknown[]) => c[0] === secondPath)).toHaveLength(1)
	})

	it("resolves fresh for a different storage root (defaultPath) with the same config", async () => {
		const customPath = "/test/storage/path"
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		await getStorageBasePath("/test/global-storage-a")
		await getStorageBasePath("/test/global-storage-b")

		const mkdirCalls = (fsPromises as any).mkdir.mock.calls.filter((c: unknown[]) => c[0] === customPath)
		expect(mkdirCalls).toHaveLength(2)
	})

	it("does not cache fs failures - the next call retries and can succeed", async () => {
		const customPath = "/test/storage/flaky"
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)
		const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const mkdirMock = (fsPromises as any).mkdir as ReturnType<typeof vi.fn>
		mkdirMock.mockImplementationOnce(async (p: string) => {
			if (p === customPath) {
				const err: any = new Error("EACCES: permission denied")
				err.code = "EACCES"
				throw err
			}
			return Promise.resolve()
		})

		// First call fails → falls back to default, shows the error.
		expect(await getStorageBasePath(defaultPath)).toBe(defaultPath)
		expect(showErrorSpy).toHaveBeenCalledTimes(1)

		// Second call is NOT served from a cache entry: it retries the fs and
		// this time succeeds, so the error is not repeated.
		expect(await getStorageBasePath(defaultPath)).toBe(customPath)
		expect(showErrorSpy).toHaveBeenCalledTimes(1)
		const mkdirCalls = mkdirMock.mock.calls.filter((c: unknown[]) => c[0] === customPath)
		expect(mkdirCalls).toHaveLength(2)
	})

	it("getTaskDirectoryPath memoizes the storage root but still mkdirs the task dir per call", async () => {
		const customPath = "/test/storage/path"
		const vscode = await freshVscode()
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const fsPromises = await import("fs/promises")
		const { getTaskDirectoryPath } = await import("../storage")

		const first = await getTaskDirectoryPath(defaultPath, "task-1")
		const second = await getTaskDirectoryPath(defaultPath, "task-1")

		expect(first).toBe(`${customPath}/tasks/task-1`)
		expect(second).toBe(`${customPath}/tasks/task-1`)
		// Storage-root mkdir runs once (memoized)...
		const rootMkdirCalls = (fsPromises as any).mkdir.mock.calls.filter((c: unknown[]) => c[0] === customPath)
		expect(rootMkdirCalls).toHaveLength(1)
		// ...but the per-task mkdir still runs per call (task dirs can be
		// deleted at runtime, so their existence must not be cached).
		const taskMkdirCalls = (fsPromises as any).mkdir.mock.calls.filter((c: unknown[]) => c[0] === first)
		expect(taskMkdirCalls).toHaveLength(2)
	})
})
