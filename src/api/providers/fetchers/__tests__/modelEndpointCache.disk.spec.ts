// npx vitest run api/providers/fetchers/__tests__/modelEndpointCache.disk.spec.ts
//
// Exercises the real disk cache of modelEndpointCache (no fs mocks): the
// endpoints written after a successful fetch must be found again by the read
// path, which is the fallback used when OpenRouter cannot be reached.

import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"

const state = vi.hoisted(() => ({ globalStoragePath: "" }))

vi.mock("../../../../core/config/ContextProxy", () => ({
	ContextProxy: {
		get instance() {
			return { globalStorageUri: { fsPath: state.globalStoragePath } }
		},
	},
}))

vi.mock("../modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
}))

vi.mock("../openrouter", () => ({
	getOpenRouterModelEndpoints: vi.fn(),
}))

const MODEL_ID = "anthropic/claude-sonnet-4"

const endpoints = {
	anthropic: {
		maxTokens: 8192,
		contextWindow: 200000,
		supportsPromptCache: true,
		inputPrice: 3,
		outputPrice: 15,
	},
}

// A fresh import gives a fresh module-level NodeCache, which is what an
// extension restart looks like to this module.
async function loadFreshModule() {
	vi.resetModules()
	const cacheModule = await import("../modelEndpointCache")
	const openrouter = await import("../openrouter")
	return { cacheModule, getOpenRouterModelEndpoints: vi.mocked(openrouter.getOpenRouterModelEndpoints) }
}

describe("modelEndpointCache disk cache", () => {
	beforeEach(async () => {
		state.globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "roo-endpoint-cache-"))
	})

	afterEach(async () => {
		await fs.rm(state.globalStoragePath, { recursive: true, force: true })
	})

	it("writes the endpoints to a file that the read path looks for", async () => {
		const { cacheModule, getOpenRouterModelEndpoints } = await loadFreshModule()
		getOpenRouterModelEndpoints.mockResolvedValueOnce(structuredClone(endpoints))

		await cacheModule.getModelEndpoints({ router: "openrouter", modelId: MODEL_ID, endpoint: "anthropic" })

		const files = await fs.readdir(path.join(state.globalStoragePath, "cache"))
		expect(files).toHaveLength(1)

		// Offline (the fetcher swallows errors and returns {}) after a memory
		// cache reset: the answer must come from the file written above.
		const second = await loadFreshModule()
		second.getOpenRouterModelEndpoints.mockResolvedValueOnce({})

		const result = await second.cacheModule.getModelEndpoints({
			router: "openrouter",
			modelId: MODEL_ID,
			endpoint: "anthropic",
		})

		expect(result).toEqual(endpoints)
	})

	it("keeps the disk entries of different models apart", async () => {
		const { cacheModule, getOpenRouterModelEndpoints } = await loadFreshModule()
		const otherEndpoints = { openai: { ...endpoints.anthropic, contextWindow: 128000 } }
		getOpenRouterModelEndpoints.mockResolvedValueOnce(structuredClone(endpoints))
		getOpenRouterModelEndpoints.mockResolvedValueOnce(structuredClone(otherEndpoints))

		await cacheModule.getModelEndpoints({ router: "openrouter", modelId: MODEL_ID, endpoint: "anthropic" })
		await cacheModule.getModelEndpoints({ router: "openrouter", modelId: "openai/gpt-5", endpoint: "openai" })

		const second = await loadFreshModule()
		second.getOpenRouterModelEndpoints.mockResolvedValue({})

		expect(
			await second.cacheModule.getModelEndpoints({
				router: "openrouter",
				modelId: "openai/gpt-5",
				endpoint: "openai",
			}),
		).toEqual(otherEndpoints)
		expect(
			await second.cacheModule.getModelEndpoints({
				router: "openrouter",
				modelId: MODEL_ID,
				endpoint: "anthropic",
			}),
		).toEqual(endpoints)
	})
})
