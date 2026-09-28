// cd src && ./node_modules/.bin/vitest run api/providers/fetchers/__tests__/modelCache.custom-storage.spec.ts
//
// ai_plans/2026-09-28_model-cache-custom-storage-path.md: the model list is
// written through `getCacheDirectoryPath`, which honours the
// `customStoragePath` setting, but the synchronous cold read in
// `getModelsFromCache` (the first lookup of a provider after startup) looked
// in `<globalStorage>/cache` instead. With a custom storage path the first
// `getModel()` after a restart therefore fell back to default model info even
// though a valid cache file existed. These specs pin that reads and writes use
// the same directory.

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const { storage } = vi.hoisted(() => ({ storage: { globalDir: "", customDir: "" } }))

vi.mock("vscode", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vscode")>()
	return {
		...actual,
		workspace: {
			...actual.workspace,
			getConfiguration: () => ({
				get: (key: string, defaultValue: unknown) =>
					key === "customStoragePath" ? storage.customDir : defaultValue,
			}),
		},
	}
})

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() } },
}))

vi.mock("../../../../core/config/ContextProxy", () => ({
	ContextProxy: {
		get instance() {
			return { globalStorageUri: { fsPath: storage.globalDir } }
		},
	},
}))

vi.mock("../openrouter", () => ({ getOpenRouterModels: vi.fn() }))
vi.mock("../litellm")
vi.mock("../deepseek")

const MODELS = { "vendor/model-a": { contextWindow: 128_000, supportsPromptCache: false } }
const STALE_MODELS = { "vendor/stale": { contextWindow: 4_096, supportsPromptCache: false } }

type ModelCacheModule = typeof import("../modelCache")

async function loadModule(): Promise<ModelCacheModule> {
	// Fresh module state (memory cache, disk mirror, storage memo): a restart.
	vi.resetModules()
	return import("../modelCache")
}

function writeCacheFile(baseDir: string, provider: string, data: unknown): void {
	const file = path.join(baseDir, "cache", `${provider}_models.json`)
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, JSON.stringify(data))
}

describe("modelCache with a custom storage path", () => {
	beforeEach(() => {
		storage.globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "model-cache-global-"))
		storage.customDir = fs.mkdtempSync(path.join(os.tmpdir(), "model-cache-custom-"))
	})

	afterEach(() => {
		fs.rmSync(storage.globalDir, { recursive: true, force: true })
		fs.rmSync(storage.customDir, { recursive: true, force: true })
	})

	it("finds the cache file in the custom storage path on the first lookup after startup", async () => {
		writeCacheFile(storage.customDir, "openrouter", MODELS)
		const { getModelsFromCache } = await loadModule()

		expect(getModelsFromCache("openrouter")).toEqual(MODELS)
	})

	it("does not serve a stale file from the default global storage when a custom path is set", async () => {
		writeCacheFile(storage.globalDir, "openrouter", STALE_MODELS)
		writeCacheFile(storage.customDir, "openrouter", MODELS)
		const { getModelsFromCache } = await loadModule()

		expect(getModelsFromCache("openrouter")).toEqual(MODELS)
	})

	it("reads back, after a restart, the list a previous process wrote", async () => {
		const first = await loadModule()
		const { getOpenRouterModels } = await import("../openrouter")
		vi.mocked(getOpenRouterModels).mockResolvedValue(MODELS as never)
		await first.getModels({ provider: "openrouter" })

		expect(fs.existsSync(path.join(storage.customDir, "cache", "openrouter_models.json"))).toBe(true)

		const second = await loadModule()
		expect(second.getModelsFromCache("openrouter")).toEqual(MODELS)
	})

	it("still reads from the default global storage when no custom path is set", async () => {
		storage.customDir = ""
		writeCacheFile(storage.globalDir, "openrouter", MODELS)
		const { getModelsFromCache } = await loadModule()

		expect(getModelsFromCache("openrouter")).toEqual(MODELS)
	})
})
