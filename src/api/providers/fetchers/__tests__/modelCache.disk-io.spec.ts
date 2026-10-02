// cd src && ./node_modules/.bin/vitest run api/providers/fetchers/__tests__/modelCache.disk-io.spec.ts
//
// P10 (ai_plans/2026-09-28_p10-async-file-io.md): `getModelsFromCache` is
// synchronous because `getModel()` / `resolveModel()` are, and they run on every
// API request. On a memory miss it used to read (or at least stat) the disk
// cache file synchronously, which happened again after every 5 minute memory
// expiry and on EVERY call for a provider with no cache file. These specs pin
// the fix: one synchronous cold read per provider per process at most, every
// later disk access asynchronous.

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const { storage } = vi.hoisted(() => ({ storage: { dir: "" } }))

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>()
	const wrapped = {
		...actual,
		existsSync: vi.fn(actual.existsSync),
		readFileSync: vi.fn(actual.readFileSync),
		statSync: vi.fn(actual.statSync),
	}
	return { ...wrapped, default: wrapped }
})

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() } },
}))

vi.mock("../../../../core/config/ContextProxy", () => ({
	ContextProxy: {
		get instance() {
			return { globalStorageUri: { fsPath: storage.dir } }
		},
	},
}))

vi.mock("../openrouter", () => ({ getOpenRouterModels: vi.fn() }))
vi.mock("../litellm")
vi.mock("../deepseek")

const MODELS = { "vendor/model-a": { contextWindow: 128_000, supportsPromptCache: false } }
const NEWER_MODELS = { "vendor/model-b": { contextWindow: 256_000, supportsPromptCache: true } }

type ModelCacheModule = typeof import("../modelCache")

async function loadModule(): Promise<ModelCacheModule> {
	// Fresh module state (memory cache, disk mirror) for every case.
	vi.resetModules()
	return import("../modelCache")
}

function cacheFile(provider: string): string {
	return path.join(storage.dir, "cache", `${provider}_models.json`)
}

function writeCacheFile(provider: string, data: unknown): void {
	fs.mkdirSync(path.dirname(cacheFile(provider)), { recursive: true })
	fs.writeFileSync(cacheFile(provider), JSON.stringify(data))
}

function syncReadCount(): number {
	return vi.mocked(fs.readFileSync).mock.calls.length + vi.mocked(fs.existsSync).mock.calls.length
}

describe("modelCache disk I/O (P10)", () => {
	beforeEach(() => {
		storage.dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-cache-io-"))
		vi.mocked(fs.readFileSync).mockClear()
		vi.mocked(fs.existsSync).mockClear()
	})

	afterEach(() => {
		vi.useRealTimers()
		fs.rmSync(storage.dir, { recursive: true, force: true })
	})

	it("reads a provider's disk cache synchronously at most once per process", async () => {
		writeCacheFile("openrouter", MODELS)
		const { getModelsFromCache, flushModels } = await loadModule()

		for (let i = 0; i < 20; i++) {
			// Simulates the 5 minute memory expiry between requests.
			await flushModels({ provider: "openrouter" }, false)
			expect(getModelsFromCache("openrouter")).toEqual(MODELS)
		}

		expect(vi.mocked(fs.readFileSync).mock.calls.length).toBeLessThanOrEqual(1)
		expect(vi.mocked(fs.existsSync).mock.calls.length).toBeLessThanOrEqual(1)
	})

	it("does not touch the disk on every call when no cache file exists", async () => {
		const { getModelsFromCache } = await loadModule()

		for (let i = 0; i < 50; i++) {
			expect(getModelsFromCache("openrouter")).toBeUndefined()
		}

		expect(syncReadCount()).toBeLessThanOrEqual(1)
	})

	it("getModels reads the disk cache asynchronously", async () => {
		writeCacheFile("openrouter", MODELS)
		const { getModels } = await loadModule()
		const { getOpenRouterModels } = await import("../openrouter")

		await expect(getModels({ provider: "openrouter" })).resolves.toEqual(MODELS)

		expect(getOpenRouterModels).not.toHaveBeenCalled()
		expect(syncReadCount()).toBe(0)
	})

	it("serves a freshly fetched list after memory expiry without reading the disk back", async () => {
		const { getModels, getModelsFromCache, flushModels } = await loadModule()
		const { getOpenRouterModels } = await import("../openrouter")
		vi.mocked(getOpenRouterModels).mockResolvedValue(MODELS as never)

		await getModels({ provider: "openrouter" })
		await flushModels({ provider: "openrouter" }, false)
		vi.mocked(fs.readFileSync).mockClear()
		vi.mocked(fs.existsSync).mockClear()

		expect(getModelsFromCache("openrouter")).toEqual(MODELS)
		expect(syncReadCount()).toBe(0)
	})

	it("picks up a cache file written by another window in the background", async () => {
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(new Date("2026-09-28T10:00:00Z"))
		const { getModelsFromCache } = await loadModule()

		expect(getModelsFromCache("openrouter")).toBeUndefined()
		const coldReads = syncReadCount()

		// Another VS Code window fetches the list and writes the shared file.
		writeCacheFile("openrouter", NEWER_MODELS)
		vi.setSystemTime(new Date("2026-09-28T10:06:00Z"))

		await vi.waitFor(() => expect(getModelsFromCache("openrouter")).toEqual(NEWER_MODELS))
		expect(syncReadCount()).toBe(coldReads)
	})
})
